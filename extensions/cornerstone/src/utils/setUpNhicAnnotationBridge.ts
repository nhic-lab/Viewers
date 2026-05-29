import * as csTools from '@cornerstonejs/tools';
import { eventTarget, getRenderingEngines, metaData } from '@cornerstonejs/core';

const { Enums: csToolsEnums } = csTools;

let isHydrating = false;
let isExternalDeletion = false;

/*
 * Batched debounce for ANNOTATION_MODIFIED events.
 * Accumulates the latest payload per annotationUID and flushes all at once
 * after MODIFICATION_DEBOUNCE_MS of inactivity — preventing a postMessage
 * (and the parent's resulting GET request) on every cursor move.
 */
const pendingModifications = new Map<string, ReturnType<typeof mapAnnotation>>();
let modificationTimer: ReturnType<typeof setTimeout> | null = null;
const MODIFICATION_DEBOUNCE_MS = 250;

/*
 * Replace non-serializable class instances in annotation.data with a
 * storage-safe shape. Only SplineROI needs this today — data.spline.instance
 * is a live spline class (CatmullRomSpline/BSpline/…) whose methods live on
 * the prototype and disappear after a JSON round-trip, crashing the render.
 */
function sanitizeDataForTransport(data: any): any {
  if (!data) return data;
  const out = { ...data };
  if (data.spline && typeof data.spline === 'object') {
    out.spline = { type: data.spline.type, resolution: data.spline.resolution };
  }
  return out;
}

/*
 * Resolve a spline-type enum string to its class constructor. The classes
 * live under csTools.splines.* (namespace re-export), not at the top level.
 */
function getSplineClass(type: string | undefined): any | null {
  if (!type) return null;
  const splines = (csTools as any).splines;
  if (!splines) return null;
  switch (type) {
    case 'CATMULLROM':
      return splines.CatmullRomSpline ?? null;
    case 'BSPLINE':
      return splines.BSpline ?? null;
    case 'LINEAR':
      return splines.LinearSpline ?? null;
    case 'CARDINAL':
      return splines.CardinalSpline ?? null;
    default:
      return null;
  }
}

/*
 * Rebuild non-serializable fields in place before addAnnotation. Returns
 * true if the annotation is safe to add, false if not — callers MUST skip
 * addAnnotation on false, since SplineROITool crashes on render if
 * data.spline or data.spline.instance is missing (both
 * renderAnnotationInstance and isPointNearTool assume a live instance).
 */
function rehydrateToolSpecificData(toolName: string, data: any): boolean {
  if (toolName !== 'SplineROI') return true;
  if (!data?.spline) return false;

  const SplineCtor = getSplineClass(data.spline.type);
  const controlPoints = data?.handles?.points;

  if (!SplineCtor || !Array.isArray(controlPoints)) return false;

  try {
    const instance = new SplineCtor();
    if (
      typeof data.spline.resolution === 'number' &&
      typeof instance.setResolution === 'function'
    ) {
      instance.setResolution(data.spline.resolution);
    }
    if (typeof instance.setClosed === 'function' && data.contour?.closed) {
      instance.setClosed(true);
    }
    if (typeof instance.setControlPoints === 'function') {
      instance.setControlPoints(controlPoints);
    }
    data.spline = {
      type: data.spline.type,
      resolution: data.spline.resolution,
      instance,
    };
    return true;
  } catch {
    return false;
  }
}

function mapAnnotation(annotation: any) {
  return {
    ohifAnnotationId: annotation.annotationUID,
    toolName: annotation.metadata?.toolName ?? '',
    label: annotation.data?.label ?? '',
    sopInstanceUid: annotation.metadata?.referencedImageId ?? '',
    frameIndex: annotation.metadata?.frameNumber ?? 0,
    data: {
      ...sanitizeDataForTransport(annotation.data ?? {}),
      /*
       * Preserve full Cornerstone metadata (FrameOfReferenceUID, viewPlaneNormal,
       * viewUp, referencedImageId) so hydration can reconstruct the annotation
       * exactly on the correct viewport.
       */
      _meta: annotation.metadata ?? {},
    },
  };
}

export function setUpNhicAnnotationBridge(): () => void {
  const onAnnotationAdded = (evt: any) => {
    if (isHydrating) return;
    if (!evt.detail.annotation?.metadata?.referencedImageId) return;
    const payload = mapAnnotation(evt.detail.annotation);
    window.parent.postMessage({ type: 'NHIC_ANNOTATION_CREATED', payload }, '*');
  };

  const onAnnotationModified = (evt: any) => {
    if (isHydrating) return;
    const annotation = evt.detail.annotation;
    if (!annotation?.metadata?.referencedImageId) return;

    // Overwrite previous payload for same UID; distinct UIDs are all preserved.
    pendingModifications.set(annotation.annotationUID, mapAnnotation(annotation));

    if (modificationTimer !== null) clearTimeout(modificationTimer);
    modificationTimer = setTimeout(() => {
      modificationTimer = null;
      for (const payload of pendingModifications.values()) {
        window.parent.postMessage({ type: 'NHIC_ANNOTATION_UPDATED', payload }, '*');
      }
      pendingModifications.clear();
    }, MODIFICATION_DEBOUNCE_MS);
  };

  const onAnnotationRemoved = (evt: any) => {
    const annotationUID = evt.detail.annotation.annotationUID;
    // Drop any pending update so the parent doesn't receive a spurious UPDATED after deletion.
    pendingModifications.delete(annotationUID);
    // When the deletion was triggered externally (via NHIC_ANNOTATION_DELETE postMessage),
    // skip echoing back to avoid a duplicate API DELETE call.
    if (isExternalDeletion) return;
    window.parent.postMessage(
      {
        type: 'NHIC_ANNOTATION_DELETED',
        payload: { ohifAnnotationId: annotationUID },
      },
      '*'
    );
  };

  const onMessage = (event: MessageEvent) => {
    if (event.data?.type === 'NHIC_ANNOTATION_DELETE') {
      const ohifAnnotationId = event.data.payload?.ohifAnnotationId;
      if (!ohifAnnotationId) return;
      isExternalDeletion = true;
      try {
        csTools.annotation.state.removeAnnotation(ohifAnnotationId);
        try {
          getRenderingEngines().forEach(engine => engine.render());
        } catch {
          // Rendering engine may not be ready; next interaction triggers a render.
        }
      } finally {
        isExternalDeletion = false;
      }
      return;
    }

    if (event.data?.type !== 'NHIC_ANNOTATIONS_HYDRATE') {
      return;
    }

    const annotations: any[] = event.data.payload?.annotations ?? [];

    isHydrating = true;
    try {
      for (const ann of annotations) {
        try {
          const { _meta, ...annotationData } = ann.data ?? {};

          const referencedImageId = _meta?.referencedImageId ?? ann.sopInstanceUid;

          /*
           * FrameOfReferenceUID is the group key used by Cornerstone3D's
           * AnnotationManager. Without it, addAnnotation stores the annotation
           * under `undefined` and no viewport can ever find or render it.
           * Prefer _meta (full preserved metadata), then fall back to the
           * imagePlaneModule lookup so all tool types work regardless of
           * whether the parent preserved _meta.
           */
          let frameOfReferenceUID: string | undefined = _meta?.FrameOfReferenceUID;
          if (!frameOfReferenceUID && referencedImageId) {
            frameOfReferenceUID =
              metaData.get('imagePlaneModule', referencedImageId)?.frameOfReferenceUID;
          }

          const resolvedMetadata = _meta
            ? { ..._meta, FrameOfReferenceUID: frameOfReferenceUID }
            : {
                toolName: ann.toolName,
                referencedImageId,
                frameNumber: ann.frameIndex,
                FrameOfReferenceUID: frameOfReferenceUID,
              };

          const annotationObj = {
            annotationUID: ann.ohifAnnotationId,
            metadata: resolvedMetadata,
            data: annotationData,
            highlighted: false,
            /*
             * Force stat recalculation on first render. cachedStats keys are
             * WADO imageId URLs that may differ after a JSON round-trip through
             * the parent, so stale stats must be recomputed.
             */
            invalidated: true,
            isLocked: false,
            isVisible: true,
          };

          const safe = rehydrateToolSpecificData(
            resolvedMetadata.toolName,
            annotationObj.data
          );
          if (!safe) {
            console.warn(
              `[NHIC] Skipping SplineROI annotation ${ann.ohifAnnotationId}: could not reconstruct spline instance`
            );
            continue;
          }

          csTools.annotation.state.addAnnotation(annotationObj);
        } catch (err) {
          console.warn(`[NHIC] Failed to hydrate annotation ${ann.ohifAnnotationId}:`, err);
        }
      }
    } finally {
      isHydrating = false;
    }

    if (annotations.length > 0) {
      try {
        getRenderingEngines().forEach(engine => engine.render());
      } catch {
        // Rendering engine may not be ready yet; next user interaction triggers a render.
      }
    }
  };

  eventTarget.addEventListener(csToolsEnums.Events.ANNOTATION_ADDED, onAnnotationAdded);
  eventTarget.addEventListener(csToolsEnums.Events.ANNOTATION_MODIFIED, onAnnotationModified);
  eventTarget.addEventListener(csToolsEnums.Events.ANNOTATION_REMOVED, onAnnotationRemoved);
  window.addEventListener('message', onMessage);

  return () => {
    eventTarget.removeEventListener(csToolsEnums.Events.ANNOTATION_ADDED, onAnnotationAdded);
    eventTarget.removeEventListener(csToolsEnums.Events.ANNOTATION_MODIFIED, onAnnotationModified);
    eventTarget.removeEventListener(csToolsEnums.Events.ANNOTATION_REMOVED, onAnnotationRemoved);
    window.removeEventListener('message', onMessage);
    if (modificationTimer !== null) {
      clearTimeout(modificationTimer);
      modificationTimer = null;
    }
    pendingModifications.clear();
  };
}
