import * as csTools from '@cornerstonejs/tools';
import { eventTarget } from '@cornerstonejs/core';

// TODO: emit NHIC_ANNOTATIONS_REQUEST from onModeEnter when viewports are ready

const { Enums: csToolsEnums } = csTools;

let isHydrating = false;

function mapAnnotation(annotation: any) {
  return {
    ohifAnnotationId: annotation.annotationUID,
    toolName: annotation.metadata?.toolName ?? '',
    label: annotation.data?.label ?? '',
    sopInstanceUid: annotation.metadata?.referencedImageId ?? '',
    frameIndex: annotation.metadata?.frameNumber ?? 0,
    data: annotation.data ?? {},
  };
}

export function setUpNhicAnnotationBridge(): () => void {
  const onAnnotationAdded = (evt: any) => {
    if (isHydrating) {
      return;
    }
    const payload = mapAnnotation(evt.detail.annotation);
    window.parent.postMessage({ type: 'NHIC_ANNOTATION_CREATED', payload }, '*');
  };

  const onAnnotationModified = (evt: any) => {
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
        const annotationObj = {
          annotationUID: ann.ohifAnnotationId,
          metadata: {
            toolName: ann.toolName,
            referencedImageId: ann.sopInstanceUid,
            frameNumber: ann.frameIndex,
          },
          data: ann.data ?? {},
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
