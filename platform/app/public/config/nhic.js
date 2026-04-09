window.config = {
  routerBasename: "/",
  extensions: [],
  modes: [],
  showStudyList: false,
  maxNumberOfWebWorkers: 3,
  defaultDataSourceName: "dicomweb",
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
  whiteLabeling: {
    createLogoComponentFn: function (React) {
      return React.createElement(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "12px" } },
        React.createElement("img", {
          src: "/logo.svg",
          alt: "Ministry of Health logo",
          style: { height: "30px", width: "auto", flexShrink: 0 },
        }),
        React.createElement(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "2px" } },
          React.createElement(
            "span",
            {
              style: {
                fontSize: "15px",
                fontWeight: "600",
                lineHeight: 1.2,
                color: "#ffffff",
              },
            },
            "Ministry of Health"
          ),
          React.createElement(
            "p",
            {
              style: {
                fontSize: "10px",
                lineHeight: 1.2,
                color: "#ffffff",
                margin: 0,
              },
            },
            "DICOM Viewer"
          )
        )
      );
    },
  },
};
