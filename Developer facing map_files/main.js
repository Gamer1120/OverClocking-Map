(() => {
  "use strict";

  const config = {
    token:
      "pk.eyJ1IjoibmlhbnRpYy1tYXBib3giLCJhIjoiY2wyeXVtdjk4MTJ5NDNqbGdjdmQ2OXQxZCJ9.rj2v7YEMszZVuot4zVLBVQ",
    style: "dark-v10",
    csvUrl: "https://oc-map.ingress.wiki/POIdb.csv",
    cacheBuster: true,
    zoom: 7, // Adjust the zoom level for a suitable view of the Netherlands
    defaultCenter: [5.2913, 52.1326], // Coordinates for the center of the Netherlands
  };

  const obConfig = {
    url: "https://openbanners.org:5001/export_activated_pois",
    queued_url: "https://openbanners.org:5001/export_queued_pois",
  };

  function parseCSV(data) {
    const lines = data.split("\n");
    const records = [];
    let headers = lines[0].split(",");
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(",");
      if (row.length === headers.length) {
        const record = {};
        for (let j = 0; j < headers.length; j++) {
          record[headers[j].trim()] = row[j].trim();
        }
        records.push(record);
      }
    }
    return records;
  }

  function loadMapData(url, callback) {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.onreadystatechange = () => {
      if (xhr.readyState === XMLHttpRequest.DONE) {
        callback(xhr.responseText);
      }
    };
    xhr.send();
  }

  function throttle(func, limit) {
    let inThrottle;
    return function () {
      const args = arguments;
      const context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  }

  function initializeMap(features, config) {
    mapboxgl.accessToken = config.token;

    const queryParams = new URLSearchParams(window.location.search);
    let initialCoords =
      queryParams.get("lat") && queryParams.get("lng")
        ? [queryParams.get("lng"), queryParams.get("lat")]
        : config.defaultCenter;

    const map = new mapboxgl.Map({
      container: "poi-map",
      style: `mapbox://styles/mapbox/${config.style}`,
      center: initialCoords,
      zoom: queryParams.get("zoom") || config.zoom,
    });

    map.on("load", () => {
      if (initialCoords && queryParams.get("showmarker") === "1") {
        new mapboxgl.Marker({ color: "rgba(0,133,163,0.9)" })
          .setLngLat(initialCoords)
          .addTo(map);
      }

      map.addSource("poi-full", {
        type: "geojson",
        data: features,
        generateId: true,
        cluster: true,
        clusterMaxZoom: 12,
        clusterRadius: 22,
      });

      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "poi-full",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "case",
            ["==", ["feature-state", "clusterColor"], "green"],
            "rgba(0,255,0,0.9)",
            ["==", ["feature-state", "clusterColor"], "yellow"],
            "rgba(255,255,0,0.9)",
            "rgba(0,133,163,0.9)", // default color
          ],
          "circle-radius": 14,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#fff",
        },
      });

      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "poi-full",
        filter: ["has", "point_count"],
        layout: {
          "text-field": "{point_count_abbreviated}",
          "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
          "text-size": 12,
        },
        paint: {
          "text-color": [
            "case",
            ["==", ["feature-state", "clusterColor"], "yellow"],
            "#000000",
            "#ffffff",
          ],
        },
      });

      map.addLayer({
        id: "poi-point",
        type: "circle",
        source: "poi-full",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            3,
            10,
            4,
            12,
            6,
            14,
            8,
          ],
          "circle-color": ["get", "color"],
          "circle-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.5,
            1,
          ],
        },
      });

      map.on("click", "clusters", (e) => {
        const features = map.queryRenderedFeatures(e.point, {
          layers: ["clusters"],
        });
        const clusterId = features[0].properties.cluster_id;
        map
          .getSource("poi-full")
          .getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err) return;
            map.easeTo({ center: features[0].geometry.coordinates, zoom });
          });
      });

      map.on("mouseenter", "clusters", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "clusters", () => {
        map.getCanvas().style.cursor = "";
      });

      let hoveredFeatureId = null;
      map.on("mouseover", "poi-point", (e) => {
        map.getCanvas().style.cursor = "pointer";
        if (hoveredFeatureId)
          map.removeFeatureState({ source: "poi-full", id: hoveredFeatureId });
        hoveredFeatureId = e.features[0].id;
        map.setFeatureState(
          { source: "poi-full", id: hoveredFeatureId },
          { hover: true }
        );
      });
      map.on("mouseleave", "poi-point", () => {
        if (hoveredFeatureId)
          map.setFeatureState(
            { source: "poi-full", id: hoveredFeatureId },
            { hover: false }
          );
        hoveredFeatureId = null;
        map.getCanvas().style.cursor = "";
      });

      map.on("click", "poi-point", (e) => {
        if (hoveredFeatureId)
          map.removeFeatureState({ source: "poi-full", id: hoveredFeatureId });
        hoveredFeatureId = e.features[0].id;
        map.setFeatureState(
          { source: "poi-full", id: hoveredFeatureId },
          { hover: true }
        );

        const coordinates = e.features[0].geometry.coordinates.slice();
        const properties = e.features[0].properties;
        const content = `
                    <strong>${properties.title}</strong>
                    ${
                      properties.localizability
                        ? `<br><p>${
                            properties.localizability.charAt(0).toUpperCase() +
                            properties.localizability.slice(1)
                          }</p>`
                        : ""
                    }
                    ${
                      properties.img
                        ? `<br><img style="max-width: 100%; height: auto; max-height: 200px; margin: 8px auto 0; display: block;" alt="image of POI ${properties.title}" src="${properties.img}">`
                        : ""
                    }
                `;

        new mapboxgl.Popup().setLngLat(coordinates).setHTML(content).addTo(map);
      });

      if (queryParams.get("gc") !== "0") {
        map.addControl(
          new MapboxGeocoder({
            accessToken: mapboxgl.accessToken,
            mapboxgl: mapboxgl,
          })
        );
      }

      function updateClusterColors() {
        const clusters = map.querySourceFeatures("poi-full", {
          filter: ["has", "point_count"],
        });

        clusters.forEach((cluster) => {
          const clusterId = cluster.properties.cluster_id;
          map
            .getSource("poi-full")
            .getClusterLeaves(clusterId, 1000, 0, (err, leaves) => {
              if (err) return;
              let greenCount = 0;
              leaves.forEach((leaf) => {
                if (leaf.properties.color === "rgba(0,255,0,0.9)") {
                  greenCount++;
                }
              });

              const clusterColor =
                greenCount === leaves.length
                  ? "green"
                  : greenCount > 0
                  ? "yellow"
                  : "blue";

              map.setFeatureState(
                { source: "poi-full", id: clusterId },
                { clusterColor: clusterColor }
              );
            });
        });
      }

      const throttledUpdate = throttle(updateClusterColors, 200);

      map.on("render", throttledUpdate);
      map.on("moveend", throttledUpdate);
    });
  }

  function convertToGeoJson(
    records,
    compareCoords = new Set(),
    compareQueuedCoords = new Set()
  ) {
    return {
      type: "FeatureCollection",
      features: records.map((row) => {
        const coordKey = `${parseFloat(row.lng).toFixed(5)},${parseFloat(
          row.lat
        ).toFixed(5)}`;
        const color = compareCoords.has(coordKey)
          ? "rgba(0,255,0,0.9)"
          : compareQueuedCoords.has(coordKey)
          ? "rgba(255, 0, 0, 0.9)"
          : "rgba(0,133,163,0.9)";
        return {
          type: "Feature",
          properties: {
            img: row.img_uri,
            title: row.title,
            address: row.address,
            localizability: row.localizability,
            color: color,
          },
          geometry: {
            type: "Point",
            coordinates: [
              parseFloat(row.lng).toFixed(6),
              parseFloat(row.lat).toFixed(6),
            ],
          },
        };
      }),
    };
  }

  const queryParams = new URLSearchParams(window.location.search);
  const csvUrl = `${config.csvUrl}?t=${
    config.cacheBuster ? queryParams.get("cb") || Math.random() : 0
  }`;

  loadMapData(obConfig.url, (obCsvData) => {
    const obRecords = parseCSV(obCsvData);
    console.log("Activated POIs:", obRecords);
    const obCoords = new Set(
      obRecords.map(
        (row) =>
          `${parseFloat(row.lng).toFixed(5)},${parseFloat(row.lat).toFixed(5)}`
      )
    );

    loadMapData(obConfig.queued_url, (obQueuedData) => {
      const obQueuedRecords = parseCSV(obQueuedData);
      console.log("Queued POIs:", obQueuedRecords);
      const obQueuedCoords = new Set(
        obQueuedRecords.map(
          (row) =>
            `${parseFloat(row.lng).toFixed(5)},${parseFloat(row.lat).toFixed(
              5
            )}`
        )
      );

      loadMapData(csvUrl, (csvData) => {
        const records = parseCSV(csvData);
        console.log("All POIs:", records);
        const geoJsonData = convertToGeoJson(records, obCoords, obQueuedCoords);
        console.log("GeoJSON Data:", geoJsonData);
        initializeMap(geoJsonData, config);
      });
    });
  });
})();
