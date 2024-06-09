(() => {
  "use strict";

  const config = {
    token:
      "pk.eyJ1IjoibmlhbnRpYy1tYXBib3giLCJhIjoiY2wyeXVtdjk4MTJ5NDNqbGdjdmQ2OXQxZCJ9.rj2v7YEMszZVuot4zVLBVQ",
    style: "dark-v10",
    csvUrl: "https://oc-map.ingress.wiki/POIdb.csv",
    cacheBuster: true,
    zoom: 4,
    defaultCenter: [-98, 39],
  };

  const base64 = {
    encode(input) {
      const characters =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      let output = "";
      let i = 0;
      while (i < input.length) {
        const chunk = (input[i++] << 16) | (input[i++] << 8) | input[i++];
        output += characters[(chunk >> 18) & 63];
        output += characters[(chunk >> 12) & 63];
        output += characters[(chunk >> 6) & 63];
        output += characters[chunk & 63];
      }
      return output;
    },
  };

  function parseCSV(data, options = {}) {
    if (typeof data === "string") data = new Uint8Array(Buffer.from(data));
    const records = [];
    let record = [];
    let field = "";
    let insideQuotes = false;

    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      if (char === 34) {
        // Double quote (")
        insideQuotes = !insideQuotes;
      } else if (char === 44 && !insideQuotes) {
        // Comma (,)
        record.push(field);
        field = "";
      } else if (char === 10 && !insideQuotes) {
        // Newline (\n)
        record.push(field);
        records.push(record);
        field = "";
        record = [];
      } else {
        field += String.fromCharCode(char);
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

      const pointLayer = {
        id: "poi-point",
        type: "circle",
        source: "poi-full",
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
          "circle-color": "rgba(0,133,163,0.9)",
          "circle-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.5,
            1,
          ],
        },
      };

      if (queryParams.get("nocluster") === "1") {
        map.addSource("poi-full", {
          type: "geojson",
          data: features,
          generateId: true,
        });
        map.addLayer(pointLayer, "waterway-label");
      } else {
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
            "circle-color": "rgba(0,133,163,0.9)",
            "circle-radius": 14,
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
        });
        pointLayer.filter = ["!", ["has", "point_count"]];
        map.addLayer(pointLayer, "waterway-label");

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
      }

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
    });
  }

  function convertToGeoJson(records) {
    return {
      type: "FeatureCollection",
      features: records.map((row) => ({
        type: "Feature",
        properties: {
          img: row.img_uri,
          title: row.title,
          address: row.address,
          localizability: row.localizability,
        },
        geometry: {
          type: "Point",
          coordinates: [
            parseFloat(row.lng).toFixed(6),
            parseFloat(row.lat).toFixed(6),
          ],
        },
      })),
    };
  }

  const queryParams = new URLSearchParams(window.location.search);
  const csvUrl = `${config.csvUrl}?t=${
    config.cacheBuster ? queryParams.get("cb") || Math.random() : 0
  }`;

  loadMapData(csvUrl, (csvData) => {
    const records = parseCSV(csvData, {
      columns: true,
      skipEmptyLines: true,
    });
    const geoJsonData = convertToGeoJson(records);
    initializeMap(geoJsonData, config);
  });
})();
