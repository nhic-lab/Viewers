window.config = {
  routerBasename: "/",
  extensions: [],
  modes: [],
  showStudyList: false,
  dataSources: [
    {
      namespace: "@ohif/extension-default.dataSourcesModule.dicomweb",
      sourceName: "dicomweb",
      configuration: {
        friendlyName: "NHIC DICOMweb",
        name: "NHIC",
        wadoUriRoot: "${DICOMWEB_ROOT}",
        qidoRoot: "${DICOMWEB_ROOT}",
        wadoRoot: "${DICOMWEB_ROOT}",
        qidoSupportsIncludeField: false,
        supportsReject: false,
        imageRendering: "wadors",
        thumbnailRendering: "wadors",
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: false,
        singlepart: "video",
        bulkDataURI: {
          enabled: true,
          relativeResolution: "studies",
        },
        omitQuotationForMultipartRequest: true,
        // NHIC backend owns all annotation persistence via its own API.
        // DICOM SR storage via Orthanc STOW-RS is intentionally disabled.
        supportsStow: false,
      },
    },
  ],
  defaultDataSourceName: "dicomweb",
};
