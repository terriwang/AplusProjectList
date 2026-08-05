(function () {
  "use strict";

  var DATA_URL = "data/hda-projects.json";

  var STATUS_ORDER = ["Recommended", "Deferred", "Not Recommended"];

  var FILTER_DEFS = [
    { key: "status", label: "Status", getValues: function (p) { return p.status ? [p.status] : []; } },
    { key: "suburb", label: "Suburb", getValues: function (p) { return p.suburb ? [p.suburb] : []; } },
    { key: "lga", label: "LGA", getValues: function (p) { return p.lga ? [p.lga] : []; } },
    { key: "planningConsultant", label: "Planning consultant", getValues: function (p) { return p.planningConsultant ? [p.planningConsultant] : []; } },
    { key: "developer", label: "Developer", getValues: function (p) { return p.developer ? [p.developer] : []; } },
    { key: "architect", label: "Architect", getValues: function (p) { return p.architect ? [p.architect] : []; } },
    { key: "projectType", label: "Project type", getValues: function (p) { return p.projectType ? [p.projectType] : []; } },
    {
      key: "concurrentRezoning",
      label: "Concurrent rezoning",
      getValues: function (p) {
        var label = concurrentRezoningLabel(p);
        return label ? [label] : [];
      }
    },
    { key: "affordableHousingPct", label: "Affordable housing %", getValues: function (p) { return splitMulti(p.affordableHousingPct); } },
    { key: "affordableHousingTenure", label: "Affordable housing tenure", getValues: function (p) { return splitMulti(p.affordableHousingTenure); } }
  ];

  var SEARCH_FIELDS = ["address", "suburb", "lga", "eoiReferenceNumber", "developer", "planningConsultant", "architect", "projectType"];

  var NOTES_STORAGE_PREFIX = "hda-note:";

  function getStoredNote(projectId) {
    try {
      return window.localStorage.getItem(NOTES_STORAGE_PREFIX + projectId) || "";
    } catch (e) {
      return "";
    }
  }

  function setStoredNote(projectId, text) {
    try {
      if (text && text.trim() !== "") {
        window.localStorage.setItem(NOTES_STORAGE_PREFIX + projectId, text);
      } else {
        window.localStorage.removeItem(NOTES_STORAGE_PREFIX + projectId);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function hasStoredNote(projectId) {
    return getStoredNote(projectId).trim() !== "";
  }

  var state = {
    projects: [],
    sourceDate: null,
    search: "",
    filters: {},        // key -> Set of selected values
    sort: { field: "address", dir: "asc" },
    openProjectId: null
  };

  FILTER_DEFS.forEach(function (def) { state.filters[def.key] = new Set(); });

  var els = {};

  function $(id) { return document.getElementById(id); }

  function splitMulti(value) {
    if (!value) return [];
    return value.split(";").map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function statusBadgeClass(status) {
    if (status === "Recommended") return "status-badge--recommended";
    if (status === "Deferred") return "status-badge--deferred";
    if (status === "Not Recommended") return "status-badge--not-recommended";
    return "status-badge--unknown";
  }

  function displayStatus(status) {
    return status || "Unknown";
  }

  function concurrentRezoningLabel(p) {
    var status = p.concurrentRezoningStatus;
    if (status === "yes") return "Concurrent Rezoning";
    if (status === "no") return "No Concurrent Rezoning";
    if (status === "unknown") return "Concurrent Rezoning Unknown";
    if (status === "other" && p.concurrentRezoningRaw) return p.concurrentRezoningRaw;
    return null;
  }

  function formatAffordableHousing(project) {
    var pct = project.affordableHousingPct;
    var tenure = project.affordableHousingTenure;
    if (!pct && !tenure) return "None";
    if (pct && pct.toLowerCase() === "unknown" && (!tenure || tenure.toLowerCase() === "unknown")) return "Unknown";
    if (pct && tenure) return escapeHtml(pct) + " \u00B7 " + escapeHtml(tenure);
    if (pct) return escapeHtml(pct);
    return escapeHtml(tenure);
  }

  /* ---------------- Data loading ---------------- */

  function loadData() {
    fetch(DATA_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        state.projects = json.projects || [];
        state.sourceDate = json.generatedAt || null;
        var rawSourceDate = (state.projects[0] && state.projects[0].date) || null;
        renderSourceDate(rawSourceDate);
        restoreStateFromUrl();
        buildFilterPanel();
        render();
      })
      .catch(function (err) {
        console.error("Failed to load HDA project data:", err);
        $("loadErrorState").hidden = false;
        $("tableWrap").hidden = true;
      });
  }

  function renderSourceDate(dateStr) {
    if (!dateStr) return;
    var d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) {
      $("sourceDate").textContent = dateStr;
      return;
    }
    $("sourceDate").textContent = d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  }

  /* ---------------- Filtering ---------------- */

  function projectMatchesSearch(p, query) {
    if (!query) return true;
    var q = query.toLowerCase();
    for (var i = 0; i < SEARCH_FIELDS.length; i++) {
      var v = p[SEARCH_FIELDS[i]];
      if (v && String(v).toLowerCase().indexOf(q) !== -1) return true;
    }
    return false;
  }

  function projectMatchesFilters(p) {
    for (var i = 0; i < FILTER_DEFS.length; i++) {
      var def = FILTER_DEFS[i];
      var selected = state.filters[def.key];
      if (selected.size === 0) continue;
      var values = def.getValues(p);
      var matchesAny = values.some(function (v) { return selected.has(v); });
      if (!matchesAny) return false;
    }
    return true;
  }

  function getFilteredProjects(excludeKey) {
    return state.projects.filter(function (p) {
      if (!projectMatchesSearch(p, state.search)) return false;
      for (var i = 0; i < FILTER_DEFS.length; i++) {
        var def = FILTER_DEFS[i];
        if (def.key === excludeKey) continue;
        var selected = state.filters[def.key];
        if (selected.size === 0) continue;
        var values = def.getValues(p);
        var matchesAny = values.some(function (v) { return selected.has(v); });
        if (!matchesAny) return false;
      }
      return true;
    });
  }

  function getFullyFilteredProjects() {
    return state.projects.filter(function (p) {
      return projectMatchesSearch(p, state.search) && projectMatchesFilters(p);
    });
  }

  /* ---------------- Filter panel ---------------- */

  function buildFilterPanel() {
    var container = $("filterGroups");
    container.innerHTML = "";

    FILTER_DEFS.forEach(function (def) {
      var group = document.createElement("div");
      group.className = "filter-group";
      group.dataset.key = def.key;

      var titleRow = document.createElement("div");
      titleRow.className = "filter-group__title-row";

      var title = document.createElement("button");
      title.type = "button";
      title.className = "filter-group__title";
      title.innerHTML = '<span>' + escapeHtml(def.label) + '</span><span class="chevron">\u25BE</span>';
      title.addEventListener("click", function () {
        group.classList.toggle("collapsed");
      });

      var selectAllBtn = document.createElement("button");
      selectAllBtn.type = "button";
      selectAllBtn.className = "filter-group__select-all";
      selectAllBtn.textContent = "All";
      selectAllBtn.setAttribute("aria-label", "Select all " + def.label + " options");

      titleRow.appendChild(title);
      titleRow.appendChild(selectAllBtn);
      group.appendChild(titleRow);

      var content = document.createElement("div");
      content.className = "filter-group__content";

      var allValues = new Set();
      state.projects.forEach(function (p) { def.getValues(p).forEach(function (v) { if (v) allValues.add(v); }); });
      var sortedValues = Array.from(allValues).sort(function (a, b) {
        if (def.key === "status") {
          return STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b);
        }
        return a.localeCompare(b);
      });

      if (sortedValues.length > 8) {
        var searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.className = "filter-group__search";
        searchInput.placeholder = "Search " + def.label.toLowerCase() + "\u2026";
        searchInput.setAttribute("aria-label", "Search " + def.label);
        searchInput.addEventListener("input", function () {
          filterOptionList(content, searchInput.value);
        });
        content.appendChild(searchInput);
      }

      var optionsWrap = document.createElement("div");
      optionsWrap.className = "filter-options";
      var checkboxes = [];

      sortedValues.forEach(function (value) {
        var label = document.createElement("label");
        label.className = "filter-option";
        label.dataset.value = value.toLowerCase();

        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = value;
        checkbox.checked = state.filters[def.key].has(value);
        checkbox.addEventListener("change", function () {
          toggleFilterValue(def.key, value, checkbox.checked);
        });
        checkboxes.push(checkbox);

        var labelText = document.createElement("span");
        labelText.className = "filter-option__label";
        labelText.textContent = value;

        var count = document.createElement("span");
        count.className = "filter-option__count";
        count.dataset.countFor = def.key + "::" + value;

        label.appendChild(checkbox);
        label.appendChild(labelText);
        label.appendChild(count);
        optionsWrap.appendChild(label);
      });

      selectAllBtn.addEventListener("click", function () {
        var allSelected = sortedValues.every(function (v) { return state.filters[def.key].has(v); });
        if (allSelected) {
          state.filters[def.key].clear();
        } else {
          sortedValues.forEach(function (v) { state.filters[def.key].add(v); });
        }
        checkboxes.forEach(function (cb) { cb.checked = state.filters[def.key].has(cb.value); });
        syncUrl();
        render();
      });

      content.appendChild(optionsWrap);
      group.appendChild(content);
      container.appendChild(group);
    });

    updateFilterCounts();
  }

  function filterOptionList(content, query) {
    var q = query.trim().toLowerCase();
    var options = content.querySelectorAll(".filter-option");
    options.forEach(function (opt) {
      var match = !q || opt.dataset.value.indexOf(q) !== -1;
      opt.classList.toggle("filter-option--no-match", !match);
    });
  }

  function updateFilterCounts() {
    FILTER_DEFS.forEach(function (def) {
      var candidates = getFilteredProjects(def.key);
      var counts = {};
      candidates.forEach(function (p) {
        def.getValues(p).forEach(function (v) {
          if (!v) return;
          counts[v] = (counts[v] || 0) + 1;
        });
      });
      document.querySelectorAll('[data-count-for^="' + def.key + '::"]').forEach(function (el) {
        var value = el.dataset.countFor.slice((def.key + "::").length);
        var n = counts[value] || 0;
        el.textContent = n;
        var optionLabel = el.closest(".filter-option");
        if (optionLabel) {
          var checkbox = optionLabel.querySelector("input");
          if (!checkbox.checked) {
            optionLabel.style.opacity = n === 0 ? "0.45" : "1";
          } else {
            optionLabel.style.opacity = "1";
          }
        }
      });

      var groupEl = document.querySelector('.filter-group[data-key="' + def.key + '"]');
      if (groupEl) {
        var selectAllBtn = groupEl.querySelector(".filter-group__select-all");
        if (selectAllBtn) {
          var allValues = new Set();
          state.projects.forEach(function (p) { def.getValues(p).forEach(function (v) { if (v) allValues.add(v); }); });
          var allSelected = allValues.size > 0 && Array.from(allValues).every(function (v) { return state.filters[def.key].has(v); });
          selectAllBtn.textContent = allSelected ? "Clear" : "All";
        }
      }
    });
  }

  function toggleFilterValue(key, value, checked) {
    if (checked) {
      state.filters[key].add(value);
    } else {
      state.filters[key].delete(value);
    }
    syncUrl();
    render();
  }

  function clearAllFilters() {
    FILTER_DEFS.forEach(function (def) { state.filters[def.key].clear(); });
    state.search = "";
    $("searchInput").value = "";
    syncUrl();
    render();
  }

  /* ---------------- Active filter chips ---------------- */

  function renderActiveFilters() {
    var wrap = $("activeFilters");
    wrap.innerHTML = "";

    FILTER_DEFS.forEach(function (def) {
      state.filters[def.key].forEach(function (value) {
        var chip = document.createElement("span");
        chip.className = "filter-chip";
        chip.innerHTML =
          '<span class="filter-chip__group">' + escapeHtml(def.label) + ':</span> ' +
          '<span>' + escapeHtml(value) + '</span>';
        var removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.setAttribute("aria-label", "Remove filter " + def.label + " " + value);
        removeBtn.textContent = "\u00D7";
        removeBtn.addEventListener("click", function () {
          state.filters[def.key].delete(value);
          syncUrl();
          render();
        });
        chip.appendChild(removeBtn);
        wrap.appendChild(chip);
      });
    });

    if (state.search) {
      var searchChip = document.createElement("span");
      searchChip.className = "filter-chip";
      searchChip.innerHTML = '<span class="filter-chip__group">Search:</span> <span>' + escapeHtml(state.search) + '</span>';
      var removeSearch = document.createElement("button");
      removeSearch.type = "button";
      removeSearch.setAttribute("aria-label", "Clear search");
      removeSearch.textContent = "\u00D7";
      removeSearch.addEventListener("click", function () {
        state.search = "";
        $("searchInput").value = "";
        syncUrl();
        render();
      });
      searchChip.appendChild(removeSearch);
      wrap.appendChild(searchChip);
    }
  }

  /* ---------------- Sorting ---------------- */

  function sortProjects(list) {
    var field = state.sort.field;
    var dir = state.sort.dir === "asc" ? 1 : -1;

    return list.slice().sort(function (a, b) {
      var av = a[field];
      var bv = b[field];

      if (field === "status") {
        av = STATUS_ORDER.indexOf(a.status);
        bv = STATUS_ORDER.indexOf(b.status);
      }

      var aEmpty = av === null || av === undefined || av === "";
      var bEmpty = bv === null || bv === undefined || bv === "";
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;

      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * dir;
    });
  }

  function updateSortHeaders() {
    document.querySelectorAll(".th-sort").forEach(function (btn) {
      btn.classList.remove("sort-asc", "sort-desc");
      if (btn.dataset.sort === state.sort.field) {
        btn.classList.add(state.sort.dir === "asc" ? "sort-asc" : "sort-desc");
      }
    });
  }

  /* ---------------- Rendering: table + cards ---------------- */

  function refreshNoteIndicators() {
    document.querySelectorAll(".note-indicator").forEach(function (el) {
      el.classList.toggle("note-indicator--visible", hasStoredNote(el.dataset.noteFor));
    });
  }

  function render() {
    var filtered = sortProjects(getFullyFilteredProjects());

    renderStats(filtered);
    renderActiveFilters();
    updateFilterCounts();
    updateSortHeaders();

    $("showingCount").textContent = "Showing " + filtered.length + " of " + state.projects.length + " projects";

    renderTable(filtered);
    renderCards(filtered);
    refreshNoteIndicators();

    var empty = filtered.length === 0;
    $("emptyState").hidden = !empty;
    $("tableWrap").style.display = empty ? "none" : "";
    $("cardsWrap").style.display = empty ? "none" : "";
  }

  function renderStats(filtered) {
    var counts = { Recommended: 0, Deferred: 0, "Not Recommended": 0 };
    var totalDwellings = 0;
    filtered.forEach(function (p) {
      if (counts.hasOwnProperty(p.status)) counts[p.status]++;
      if (typeof p.dwellings === "number") totalDwellings += p.dwellings;
    });
    $("statTotal").textContent = filtered.length;
    $("statRecommended").textContent = counts.Recommended;
    $("statDeferred").textContent = counts.Deferred;
    $("statNotRecommended").textContent = counts["Not Recommended"];
    $("statDwellings").textContent = totalDwellings.toLocaleString();
  }

  function renderTable(list) {
    var tbody = $("resultsBody");
    tbody.innerHTML = "";
    var frag = document.createDocumentFragment();

    list.forEach(function (p) {
      var tr = document.createElement("tr");
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.setAttribute("aria-label", "View details for " + (p.address || "project"));
      tr.addEventListener("click", function () { openDetail(p.id); });
      tr.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(p.id); }
      });

      tr.innerHTML =
        '<td><span class="status-badge ' + statusBadgeClass(p.status) + '">' + escapeHtml(displayStatus(p.status)) + '</span></td>' +
        '<td class="address-cell">' + (p.address ? escapeHtml(p.address) : '<span class="cell-muted">Address not available in source record</span>') +
          '<span class="note-indicator" data-note-for="' + escapeHtml(p.id) + '" title="You have a saved note on this project">\u270E</span>' +
          (p.concurrentRezoningStatus === "yes" ? '<div><span class="rezoning-badge">Concurrent Rezoning</span></div>' : '') +
        '</td>' +
        '<td>' + escapeHtml(p.suburb) + '</td>' +
        '<td>' + escapeHtml(p.lga) + '</td>' +
        '<td>' + escapeHtml(p.projectType) + '</td>' +
        '<td class="num">' + (p.storeys ? escapeHtml(p.storeys) : '<span class="cell-muted">\u2014</span>') + '</td>' +
        '<td class="num">' + (p.dwellings != null ? p.dwellings : '<span class="cell-muted">\u2014</span>') + '</td>' +
        '<td>' + (p.developer ? escapeHtml(p.developer) : '<span class="cell-muted">\u2014</span>') + '</td>' +
        '<td>' + (p.planningConsultant ? escapeHtml(p.planningConsultant) : '<span class="cell-muted">\u2014</span>') + '</td>' +
        '<td>' + (p.architect ? escapeHtml(p.architect) : '<span class="cell-muted">\u2014</span>') + '</td>' +
        '<td>' + formatAffordableHousing(p) + '</td>' +
        '<td>' + escapeHtml(p.eoiReferenceNumber) + '</td>';

      frag.appendChild(tr);
    });

    tbody.appendChild(frag);
  }

  function renderCards(list) {
    var wrap = $("cardsWrap");
    wrap.innerHTML = "";
    var frag = document.createDocumentFragment();

    list.forEach(function (p) {
      var card = document.createElement("div");
      card.className = "project-card";
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", "View details for " + (p.address || "project"));
      card.addEventListener("click", function () { openDetail(p.id); });
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(p.id); }
      });

      card.innerHTML =
        '<div class="project-card__top">' +
          '<span class="status-badge ' + statusBadgeClass(p.status) + '">' + escapeHtml(displayStatus(p.status)) + '</span>' +
          '<span class="note-indicator" data-note-for="' + escapeHtml(p.id) + '" title="You have a saved note on this project">\u270E</span>' +
        '</div>' +
        '<p class="project-card__address">' + (p.address ? escapeHtml(p.address) : '<span class="cell-muted">Address not available in source record</span>') + '</p>' +
        '<p class="project-card__sub">' + escapeHtml(p.suburb) + (p.lga ? ' \u00B7 ' + escapeHtml(p.lga) : '') + '</p>' +
        '<div class="project-card__meta">' +
          (p.projectType ? '<span><strong>' + escapeHtml(p.projectType) + '</strong></span>' : '') +
          (p.storeys ? '<span>' + escapeHtml(p.storeys) + ' storeys</span>' : '') +
          (p.dwellings != null ? '<span>' + p.dwellings + ' dwellings</span>' : '') +
          '<span>' + formatAffordableHousing(p) + '</span>' +
        '</div>' +
        (p.concurrentRezoningStatus === "yes" ? '<div class="project-card__badges"><span class="rezoning-badge">Concurrent Rezoning</span></div>' : '');

      frag.appendChild(card);
    });

    wrap.appendChild(frag);
  }

  /* ---------------- Detail drawer ---------------- */

  function fieldRow(label, value, full) {
    if (value === null || value === undefined || value === "") return "";
    return '<div class="detail-field' + (full ? " detail-field--full" : "") + '">' +
      '<p class="detail-field__label">' + escapeHtml(label) + '</p>' +
      '<p class="detail-field__value">' + escapeHtml(value) + '</p>' +
    '</div>';
  }

  function renderOfficialRecord(items, rawText) {
    if (!items || items.length === 0) {
      return '<p>' + escapeHtml(rawText) + '</p>';
    }
    return items.map(function (item) {
      var cls = item.level === 1 ? "bullet-1" : "bullet-0";
      return '<p class="' + cls + '">' + escapeHtml(item.text) + '</p>';
    }).join("");
  }

  function openDetail(id) {
    var p = state.projects.find(function (proj) { return proj.id === id; });
    if (!p) return;
    state.openProjectId = id;

    $("drawerStatusBadge").innerHTML = '<span class="status-badge ' + statusBadgeClass(p.status) + '">' + escapeHtml(displayStatus(p.status)) + '</span>';
    $("drawerTitle").textContent = p.address || "Project details";

    var body = $("drawerBody");
    var html = "";

    /* Project overview */
    html += '<div class="detail-section"><h3 class="detail-section__title">Project overview</h3><div class="detail-grid">';
    html += fieldRow("Address", p.address, true);
    html += fieldRow("Suburb", p.suburb);
    html += fieldRow("LGA", p.lga);
    html += fieldRow("EOI reference number", p.eoiReferenceNumber);
    html += fieldRow("Report item no.", p.reportItemNo);
    html += fieldRow("Date", formatDisplayDate(p.date));
    html += fieldRow("Status", displayStatus(p.status));
    html += '</div></div>';

    /* Proposal */
    var proposalHtml = "";
    proposalHtml += fieldRow("Project type", p.projectType);
    proposalHtml += fieldRow("Storeys", p.storeys);
    proposalHtml += fieldRow("No. of dwellings", p.dwellings != null ? p.dwellings : null);
    proposalHtml += fieldRow("Concurrent rezoning", concurrentRezoningLabel(p));
    proposalHtml += fieldRow("Affordable housing %", p.affordableHousingPct);
    proposalHtml += fieldRow("Affordable housing tenure", p.affordableHousingTenure);
    if (proposalHtml) {
      html += '<div class="detail-section"><h3 class="detail-section__title">Proposal</h3><div class="detail-grid">' + proposalHtml + '</div></div>';
    }

    /* Project team */
    var teamHtml = "";
    teamHtml += fieldRow("Developer", p.developer);
    teamHtml += fieldRow("Planning consultant", p.planningConsultant);
    teamHtml += fieldRow("Architect", p.architect);
    if (teamHtml) {
      html += '<div class="detail-section"><h3 class="detail-section__title">Project team</h3><div class="detail-grid">' + teamHtml;
      if (p.applicantRaw) {
        html += '<div class="detail-field detail-field--full">' +
          '<p class="detail-field__label">Applicant (source reference)</p>' +
          '<p class="detail-field__value">' + escapeHtml(p.applicantRaw) + '</p>' +
        '</div>';
      }
      html += '</div></div>';
    } else if (p.applicantRaw) {
      html += '<div class="detail-section"><h3 class="detail-section__title">Project team</h3><div class="detail-grid">' +
        '<div class="detail-field detail-field--full">' +
          '<p class="detail-field__label">Applicant (source reference)</p>' +
          '<p class="detail-field__value">' + escapeHtml(p.applicantRaw) + '</p>' +
        '</div></div></div>';
    }

    /* HDA Criteria */
    html += '<div class="detail-section"><h3 class="detail-section__title">HDA criteria</h3>';
    if (p.criteriaItems && p.criteriaItems.length > 0) {
      html += '<div class="criteria-list">';
      p.criteriaItems.forEach(function (item) {
        html += '<div class="criteria-item">' +
          (item.label ? '<span class="criteria-item__label">' + escapeHtml(item.label) + '</span>' : '') +
          '<span>' + escapeHtml(item.description) + '</span>' +
        '</div>';
      });
      html += '</div>';
    } else if (p.status === "Recommended") {
      html += '<p class="criteria-fallback">The proposal adequately satisfied the HDA EOI objectives and criteria.</p>';
    } else {
      html += '<p class="criteria-fallback">No specific HDA criteria were recorded for this project.</p>';
    }
    html += '</div>';

    /* HDA advice (verbatim rejection/deferral wording or Minister/Applicant advice from the source workbook) */
    if (p.script) {
      var adviceClass = p.status === "Deferred" ? "advice-quote--deferred" : "advice-quote--not-recommended";
      html += '<div class="detail-section"><h3 class="detail-section__title">HDA advice</h3>' +
        '<p class="advice-quote ' + adviceClass + '">' + escapeHtml(p.script) + '</p>' +
      '</div>';
    }

    /* Official HDA Record (collapsible) */
    html += '<div class="detail-section"><h3 class="detail-section__title">Official HDA record</h3>' +
      '<div class="collapsible" id="officialRecordCollapsible">' +
        '<button type="button" class="collapsible__trigger" id="officialRecordTrigger" aria-expanded="false">' +
          '<span>Show official record</span><span class="chevron">\u25BE</span>' +
        '</button>' +
        '<div class="collapsible__content official-record">' + renderOfficialRecord(p.reasonFullItems, p.reasonFull) + '</div>' +
      '</div>' +
    '</div>';

    /* Notes (from the source record) */
    if (p.notes) {
      html += '<div class="detail-section"><h3 class="detail-section__title">Notes</h3>' +
        '<p class="notes-text">' + escapeHtml(p.notes) + '</p>' +
      '</div>';
    }

    /* Your notes (manually entered, saved locally in this browser) */
    var existingNote = getStoredNote(p.id);
    html += '<div class="detail-section"><h3 class="detail-section__title">Your notes</h3>' +
      '<textarea class="your-notes-textarea" id="yourNotesInput" placeholder="Add a private note for this project\u2026" aria-label="Your notes for this project">' + escapeHtml(existingNote) + '</textarea>' +
      '<div class="your-notes-actions">' +
        '<button type="button" class="btn btn--secondary" id="saveNoteBtn">Save note</button>' +
        '<span class="your-notes-status" id="noteSaveStatus" aria-live="polite"></span>' +
      '</div>' +
      '<p class="your-notes-hint">Saved only in this browser, on this device.</p>' +
    '</div>';

    body.innerHTML = html;

    var trigger = $("officialRecordTrigger");
    if (trigger) {
      trigger.addEventListener("click", function () {
        var wrap = $("officialRecordCollapsible");
        var isOpen = wrap.classList.toggle("open");
        trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
        trigger.querySelector("span").textContent = isOpen ? "Hide official record" : "Show official record";
      });
    }

    var saveNoteBtn = $("saveNoteBtn");
    var noteSaveStatus = $("noteSaveStatus");
    if (saveNoteBtn) {
      saveNoteBtn.addEventListener("click", function () {
        var textarea = $("yourNotesInput");
        var ok = setStoredNote(p.id, textarea.value);
        noteSaveStatus.textContent = ok ? "Saved" : "Could not save \u2014 storage unavailable";
        setTimeout(function () { noteSaveStatus.textContent = ""; }, 2200);
        refreshNoteIndicators();
      });
    }

    showDrawer();
  }

  function formatDisplayDate(dateStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) { /* no-op */ }
    document.body.removeChild(ta);
  }

  var lastFocusedElement = null;

  function showDrawer() {
    var drawer = $("detailDrawer");
    var backdrop = $("drawerBackdrop");
    lastFocusedElement = document.activeElement;
    drawer.hidden = false;
    backdrop.classList.add("visible");
    requestAnimationFrame(function () {
      drawer.classList.add("open");
    });
    drawer.focus();
    document.addEventListener("keydown", handleDrawerKeydown);
  }

  function closeDrawer() {
    var drawer = $("detailDrawer");
    var backdrop = $("drawerBackdrop");
    drawer.classList.remove("open");
    backdrop.classList.remove("visible");
    state.openProjectId = null;
    document.removeEventListener("keydown", handleDrawerKeydown);
    setTimeout(function () { drawer.hidden = true; }, 200);
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
  }

  function handleDrawerKeydown(e) {
    if (e.key === "Escape") closeDrawer();
  }

  /* ---------------- Mobile filter panel ---------------- */

  function openFilterPanel() {
    $("filterPanel").classList.add("open");
    $("filterPanelBackdrop").classList.add("visible");
  }

  function closeFilterPanel() {
    $("filterPanel").classList.remove("open");
    $("filterPanelBackdrop").classList.remove("visible");
  }

  /* ---------------- URL state ---------------- */

  function syncUrl() {
    var params = new URLSearchParams();
    if (state.search) params.set("q", state.search);
    FILTER_DEFS.forEach(function (def) {
      if (state.filters[def.key].size > 0) {
        params.set(def.key, Array.from(state.filters[def.key]).join("|"));
      }
    });
    if (state.sort.field !== "address" || state.sort.dir !== "asc") {
      params.set("sort", state.sort.field);
      params.set("dir", state.sort.dir);
    }
    var qs = params.toString();
    var url = window.location.pathname + (qs ? "?" + qs : "");
    window.history.replaceState(null, "", url);
  }

  function restoreStateFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var q = params.get("q");
    if (q) {
      state.search = q;
      $("searchInput").value = q;
    }
    FILTER_DEFS.forEach(function (def) {
      var raw = params.get(def.key);
      if (raw) {
        raw.split("|").forEach(function (v) { state.filters[def.key].add(v); });
      }
    });
    var sortField = params.get("sort");
    var sortDir = params.get("dir");
    if (sortField) state.sort.field = sortField;
    if (sortDir === "asc" || sortDir === "desc") state.sort.dir = sortDir;
  }

  /* ---------------- Event wiring ---------------- */

  function wireEvents() {
    $("searchInput").addEventListener("input", function (e) {
      state.search = e.target.value;
      syncUrl();
      render();
    });

    $("clearFiltersBtn").addEventListener("click", clearAllFilters);
    $("emptyStateClearBtn").addEventListener("click", clearAllFilters);

    $("closeDrawerBtn").addEventListener("click", closeDrawer);
    $("drawerBackdrop").addEventListener("click", closeDrawer);

    $("mobileFilterToggle").addEventListener("click", openFilterPanel);
    $("closeFilterPanel").addEventListener("click", closeFilterPanel);
    $("filterPanelBackdrop").addEventListener("click", closeFilterPanel);

    document.querySelectorAll(".th-sort").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var field = btn.dataset.sort;
        if (state.sort.field === field) {
          state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
        } else {
          state.sort.field = field;
          state.sort.dir = "asc";
        }
        syncUrl();
        render();
      });
    });
  }

  /* ---------------- Password gate ---------------- */

  var ACCESS_PASSWORD = "Dora789!";
  var SESSION_KEY = "hda-access-granted";

  function initPasswordGate() {
    var gate = $("passwordGate");
    var appContent = $("appContent");
    var form = $("passwordForm");
    var input = $("passwordInput");
    var errorMsg = $("passwordError");

    var alreadyUnlocked = false;
    try {
      alreadyUnlocked = window.sessionStorage.getItem(SESSION_KEY) === "true";
    } catch (e) { /* sessionStorage unavailable, fall through to prompt */ }

    if (alreadyUnlocked) {
      unlock();
      return;
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (input.value === ACCESS_PASSWORD) {
        try { window.sessionStorage.setItem(SESSION_KEY, "true"); } catch (e) { /* no-op */ }
        unlock();
      } else {
        errorMsg.hidden = false;
        input.value = "";
        input.focus();
      }
    });

    function unlock() {
      gate.hidden = true;
      appContent.hidden = false;
      wireEvents();
      loadData();
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    els = {};
    initPasswordGate();
  });
})();
