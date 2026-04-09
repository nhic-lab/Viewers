import * as csTools from '@cornerstonejs/tools';
import { eventTarget, getRenderingEngines } from '@cornerstonejs/core';

const { Enums: csToolsEnums } = csTools;

let isHydrating = false;

function mapAnnotation(annotation: any) {
  return {
    ohifAnnotationId: annotation.annotationUID,
    toolName: annotation.metadata?.toolName ?? '',
    label: annotation.data?.label ?? '',
    sopInstanceUid: annotation.metadata?.referencedImageId ?? '',
    frameIndex: annotation.metadata?.frameNumber ?? 0,
    data: {
      ...(annotation.data ?? {}),
      // Preserve the full Cornerstone metadata so hydration can reconstruct
      // the annotation exactly — FrameOfReferenceUID, viewPlaneNormal, viewUp
      // are all required for the annotation to render on the correct viewport.
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
    if (!evt.detail.annotation?.metadata?.referencedImageId) return;
    const payload = mapAnnotation(evt.detail.annotation);
    window.parent.postMessage({ type: 'NHIC_ANNOTATION_UPDATED', payload }, '*');
  };

  const onAnnotationRemoved = (evt: any) => {
    window.parent.postMessage(
      {
        type: 'NHIC_ANNOTATION_DELETED',
        payload: { ohifAnnotationId: evt.detail.annotation.annotationUID },
      },
      '*'
    );
  };

  const onMessage = (event: MessageEvent) => {
    if (event.data?.type !== 'NHIC_ANNOTATIONS_HYDRATE') {
      return;
    }

    const annotations: any[] = event.data.payload?.annotations ?? [];

    isHydrating = true;
    try {
      for (const ann of annotations) {
        const { _meta, ...annotationData } = ann.data ?? {};

        const annotationObj = {
          annotationUID: ann.ohifAnnotationId,
          // Restore full metadata saved at creation time. Fall back to the
          // individual fields for annotations created before _meta was added.
          metadata: _meta ?? {
            toolName: ann.toolName,
            referencedImageId: ann.sopInstanceUid,
            frameNumber: ann.frameIndex,
          },
          data: annotationData,
          highlighted: false,
          invalidated: false,
          isLocked: false,
          isVisible: true,
        };

        csTools.annotation.state.addAnnotation(annotationObj);
      }
    } finally {
      isHydrating = false;
    }

    // Trigger a re-render on all active rendering engines so the hydrated
    // annotations appear on screen without requiring user interaction.
    if (annotations.length > 0) {
      try {
        getRenderingEngines().forEach(engine => engine.render());
      } catch {
        // rendering engine may not be ready yet — viewport interaction will
        // trigger a render naturally on the next frame
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
  };
}
