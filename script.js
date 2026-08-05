// ----------------------
// Create Map
// ----------------------

const map = L.map("map", {
  zoomControl: true
}).setView([-24.5, 135.5], 5);


// ----------------------
// OpenStreetMap
// ----------------------

L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    attribution: "© OpenStreetMap"
  }
).addTo(map);


// ----------------------
// FIR Colours
// ----------------------

const FIR_COLORS = {
  YMMM: "#1976D2",
  YBBB: "#F9A825",
  YMMO: "#0097A7",
  NZZO: "#0097A7", // teilt sich das Grün/Türkis mit YMMO
  NZZC: "#43A047",
  AYPM: "#EF6C00"
};

const DEFAULT_COLOR = "#78909C";

// Upper und Lower CTR bekommen beide einen Blauton, aber unterscheidbar
const UPPER_CTR_COLOR = "#0D47A1"; // dunkleres Blau
const LOWER_CTR_COLOR = "#42A5F5"; // helleres Blau


// ----------------------
// State
// ----------------------

let allSectors = [];
let selectedLayer = null;
let selectedEntry = null;
let sectorMarkers = [];

// Reihenfolge der Kategorien: Upper zuerst (unten), dann Lower (oben)
const CATEGORY_ORDER = ['upper', 'lower', 'app', 'tcu', 'oceanic'];

// Verfügbare FIRs für den FIR-Filter
const FIR_LIST = ['AYPM', 'YBBB', 'YMMM', 'NZZC', 'NZZO', 'YMMO'];


// ----------------------
// Helpers
// ----------------------

function getCategory(props) {
  const type = (props.type || "").toUpperCase();
  const level = (props.level || "").toUpperCase();

  if (type === "CTR") {
    return level === "UPPER" ? "upper" : "lower";
  }
  if (type === "APP") return "app";
  if (type === "TCU") return "tcu";
  if (type === "OCEANIC" || type === "OCA") return "oceanic";
  return "lower";
}

function getColor(props) {
  const level = (props.level || "").toUpperCase();
  const type = (props.type || "").toUpperCase();

  if (type === "CTR") {
    return level === "UPPER" ? UPPER_CTR_COLOR : LOWER_CTR_COLOR;
  }
  return FIR_COLORS[props.fir] || DEFAULT_COLOR;
}

function baseStyle(props) {
  const isUpper = (props.level || "").toUpperCase() === "UPPER";
  
  return {
    color: getColor(props),
    weight: isUpper ? 3 : 2,
    opacity: 0.9,
    fillColor: getColor(props),
    fillOpacity: isUpper ? 0.15 : 0.10,
    dashArray: isUpper ? null : "6, 4"  // Lower = gestrichelt, Upper = durchgezogen
  };
}

function selectedStyle(props) {
  const isUpper = (props.level || "").toUpperCase() === "UPPER";
  
  return {
    color: getColor(props),
    weight: isUpper ? 5 : 4,
    opacity: 1,
    fillColor: getColor(props),
    fillOpacity: isUpper ? 0.35 : 0.25,
    dashArray: isUpper ? null : "4, 3"
  };
}


// ----------------------
// Sidebar
// ----------------------

function updateSidebar(props) {
  const info = document.getElementById("sectorInfo");

  if (!props) {
    info.innerHTML = "<h2>No Sector Selected</h2><p>Click on a sector marker.</p>";
    return;
  }

  const isUpper = (props.level || "").toUpperCase() === "UPPER";
  const upperBadge = isUpper ? ` <span style="color:${UPPER_CTR_COLOR};font-weight:bold;">⬆ UPPER</span>` : ` <span style="color:${LOWER_CTR_COLOR};">⬇ LOWER</span>`;

  info.innerHTML = `
    <h2>${props.name || props.short || "Unnamed Sector"}${upperBadge}</h2>
    <p><strong>Logon:</strong> ${props.logon || props.short || "-"}</p>
    <p><strong>Type:</strong> ${props.type || "-"} ${props.level ? "(" + props.level + ")" : ""}</p>
    <p><strong>FIR:</strong> ${props.fir || "-"}</p>
    <p><strong>Frequency:</strong> ${props.frequency || "-"}</p>
    <p><strong>Rating:</strong> ${props.rating || "-"}</p>
    <p><strong>CPDLC:</strong> ${props.cpdlc || "-"}</p>
    <p><strong>Lower / Upper:</strong> ${props.lower || "-"} / ${props.upper || "-"}</p>
  `;
}


// ----------------------
// Selecting a sector
// ----------------------

function selectSector(entry) {
  if (!entry) return;

  // Zurücksetzen der vorherigen Auswahl
  if (selectedLayer) {
    selectedLayer.setStyle(baseStyle(selectedLayer._sectorProps));
  }

  // Alle Marker zurücksetzen
  sectorMarkers.forEach(marker => {
    if (marker._entry && marker._entry !== entry) {
      marker.setIcon(getDefaultIcon(marker._entry));
    }
  });

  // Neue Auswahl setzen
  const style = selectedStyle(entry.feature.properties);
  entry.layer.setStyle(style);
  entry.layer.bringToFront();

  selectedLayer = entry.layer;
  selectedLayer._sectorProps = entry.feature.properties;
  selectedEntry = entry;

  // Marker hervorheben
  entry.marker.setIcon(getSelectedIcon(entry));

  updateSidebar(entry.feature.properties);

  try {
    map.fitBounds(entry.layer.getBounds(), { maxZoom: 8, padding: [40, 40] });
  } catch (e) {
    // ignore invalid bounds
  }

  closeSearchResults();
}


// ----------------------
// Icons für Marker
// ----------------------

function getDefaultIcon(entry) {
  const color = getColor(entry.props);

  return L.divIcon({
    className: 'sector-marker',
    html: `<div style="background:${color};">${entry.short.toUpperCase()}</div>`,
    iconSize: null,
    iconAnchor: null
  });
}

function getSelectedIcon(entry) {
  const color = getColor(entry.props);

  return L.divIcon({
    className: 'sector-marker selected',
    html: `<div style="background:${color};">${entry.short.toUpperCase()}</div>`,
    iconSize: null,
    iconAnchor: null
  });
}


// ----------------------
// Berechne echten Flächenschwerpunkt (Centroid) eines Polygons
// ----------------------

function ringCentroid(ring) {
  let area = 0;
  let cx = 0;
  let cy = 0;

  // Falls der Ring im GeoJSON nicht geschlossen ist (erster Punkt !=
  // letzter Punkt), fehlt sonst die Schlusskante und die Shoelace-Formel
  // liefert eine falsche Fläche/einen falschen Schwerpunkt (z.B. NZZC_N_CTR).
  const first = ring[0];
  const last = ring[ring.length - 1];
  const isClosed = first[0] === last[0] && first[1] === last[1];
  const points = isClosed ? ring : ring.concat([first]);

  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const cross = x0 * y1 - x1 * y0;

    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }

  area = area / 2;

  if (area === 0) {
    let sx = 0, sy = 0;
    ring.forEach(([x, y]) => { sx += x; sy += y; });
    return [sx / ring.length, sy / ring.length];
  }

  return [cx / (6 * area), cy / (6 * area)];
}

function getPolygonCenter(geometry) {
  let ring;

  if (geometry.type === "Polygon") {
    ring = geometry.coordinates[0];
  } else if (geometry.type === "MultiPolygon") {
    ring = geometry.coordinates[0][0];
  } else {
    return null;
  }

  const [lng, lat] = ringCentroid(ring);
  return { lat, lng };
}


// ----------------------
// Load Sectors
// ----------------------

function loadSectors() {
  fetch("sectors.geojson")
    .then(response => response.json())
    .then(data => {
      console.log("Loading sectors...");

      data.features.forEach((feature, index) => {
        const props = feature.properties || {};
        const category = getCategory(props);
        const isUpper = (props.level || "").toUpperCase() === "UPPER";
        const short = (props.short || props.logon || "UNKNOWN").toUpperCase();

        // Layer erstellen
        const layer = L.geoJSON(feature, {
          style: baseStyle(props)
        });

        let marker = null;
        let center = null;

        // Mittelpunkt berechnen
        try {
          const centerPoint = getPolygonCenter(feature.geometry);
          if (centerPoint) {
            center = L.latLng(centerPoint.lat, centerPoint.lng);
          }
        } catch(e) {
          console.warn("Could not calculate center for", short);
        }

        // Jeder Sub-Layer bekommt die Properties
        layer.eachLayer(sub => {
          sub._sectorProps = props;
          sub._isUpper = isUpper;
          sub._index = index;
          sub._entry = null;

          // Hover-Effekt
          sub.on("mouseover", () => {
            if (sub !== selectedLayer) {
              sub.setStyle({
                weight: isUpper ? 4 : 3,
                fillOpacity: isUpper ? 0.3 : 0.2,
                dashArray: isUpper ? null : "4, 3"
              });
            }
          });

          sub.on("mouseout", () => {
            if (sub !== selectedLayer) {
              sub.setStyle(baseStyle(props));
            }
          });
        });

        const entry = {
          feature: feature,
          layer: layer,
          category: category,
          name: (props.name || "").toLowerCase(),
          short: short,
          isUpper: isUpper,
          props: props,
          marker: null,
          center: center
        };

        allSectors.push(entry);

        // Marker in der Mitte erstellen (nur wenn Center verfügbar)
        if (center) {
          const icon = getDefaultIcon(entry);
          marker = L.marker(center, {
            icon: icon,
            title: short
          });

          marker._entry = entry;
          entry.marker = marker;

          marker.on("click", () => {
            selectSector(entry);
          });

          // Hover für Marker
          marker.on("mouseover", () => {
            marker.setIcon(getSelectedIcon(entry));
          });
          marker.on("mouseout", () => {
            if (selectedEntry !== entry) {
              marker.setIcon(getDefaultIcon(entry));
            }
          });

          sectorMarkers.push(marker);
        }
      });

      // Layer/Marker gemäß aktueller Filter (Kategorie + FIR) zur Karte hinzufügen
      applyFilters();

      console.log("Sectors loaded:", allSectors.length);

    })
    .catch(err => {
      console.error("Could not load sectors.geojson:", err);
    });
}


// ----------------------
// Search
// ----------------------

function closeSearchResults() {
  const results = document.getElementById("searchResults");
  results.innerHTML = "";
  results.style.display = "none";
}

function renderSearchResults(matches) {
  const results = document.getElementById("searchResults");

  if (matches.length === 0) {
    results.innerHTML = "<div class='searchEmpty'>No sectors found</div>";
    results.style.display = "block";
    return;
  }

  results.innerHTML = matches.slice(0, 15).map((entry, i) => {
    const isUpper = entry.isUpper;
    const badge = isUpper ? ' ⬆' : ' ⬇';
    return `<div class="searchItem" data-index="${allSectors.indexOf(entry)}">
       <span class="searchItemName">${entry.feature.properties.name || entry.feature.properties.short}${badge}</span>
       <span class="searchItemShort">${entry.short}</span>
     </div>`;
  }).join("");

  results.style.display = "block";

  results.querySelectorAll(".searchItem").forEach(el => {
    el.addEventListener("click", () => {
      const idx = parseInt(el.getAttribute("data-index"), 10);
      if (!isNaN(idx) && allSectors[idx]) {
        selectSector(allSectors[idx]);
      }
    });
  });
}

function createSearch() {
  const input = document.getElementById("search");

  input.addEventListener("input", () => {
    const term = input.value.trim().toLowerCase();
    if (term.length === 0) {
      closeSearchResults();
      return;
    }
    const matches = allSectors.filter(entry =>
      entry.name.includes(term) || entry.short.toLowerCase().includes(term)
    );
    renderSearchResults(matches);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const term = input.value.trim().toLowerCase();
      const match = allSectors.find(entry =>
        entry.name.includes(term) || entry.short.toLowerCase().includes(term)
      );
      if (match) {
        selectSector(match);
      }
    }
  });

  document.addEventListener("click", (e) => {
    if (e.target !== input && !e.target.closest("#searchResults")) {
      closeSearchResults();
    }
  });
}

// ----------------------
// Filters (Kategorie + FIR)
// ----------------------

function applyFilters() {
  const categoryChecked = {};
  CATEGORY_ORDER.forEach(cat => {
    const checkbox = document.getElementById(cat);
    categoryChecked[cat] = checkbox ? checkbox.checked : true;
  });

  const firChecked = {};
  FIR_LIST.forEach(fir => {
    const checkbox = document.getElementById("fir-" + fir);
    firChecked[fir] = checkbox ? checkbox.checked : true;
  });

  // In fester Kategorie-Reihenfolge neu hinzufügen, damit die
  // Z-Reihenfolge (Upper unten, Lower oben, ...) erhalten bleibt
  CATEGORY_ORDER.forEach(cat => {
    allSectors
      .filter(entry => entry.category === cat)
      .forEach(entry => {
        const fir = (entry.props.fir || "").toUpperCase();
        const firOk = firChecked.hasOwnProperty(fir) ? firChecked[fir] : true;
        const visible = categoryChecked[cat] && firOk;

        if (visible) {
          if (!map.hasLayer(entry.layer)) entry.layer.addTo(map);
          if (entry.marker && !map.hasLayer(entry.marker)) entry.marker.addTo(map);
        } else {
          if (map.hasLayer(entry.layer)) map.removeLayer(entry.layer);
          if (entry.marker && map.hasLayer(entry.marker)) map.removeLayer(entry.marker);
        }
      });
  });
}

function createFilters() {
  CATEGORY_ORDER.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) checkbox.addEventListener("change", applyFilters);
  });

  FIR_LIST.forEach(fir => {
    const checkbox = document.getElementById("fir-" + fir);
    if (checkbox) checkbox.addEventListener("change", applyFilters);
  });
}


// ----------------------
// Init
// ----------------------

loadSectors();
createSearch();
createFilters();
updateSidebar(null);