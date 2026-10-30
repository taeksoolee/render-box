// render-box admin behaviour. Only toggles data-*/aria-*/hidden/disabled
// attributes; styling reacts through Tailwind variants (docs/ui.md §0).
(function () {
  "use strict";

  var MAX_BYTES = 10 * 1024 * 1024;
  var MAX_LINKS = 10;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function announce(text) {
    var live = $("#live");
    if (!live) return;
    live.textContent = "";
    setTimeout(function () {
      live.textContent = text;
    }, 50);
  }
  function formatSize(bytes) {
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }
  function csrfToken(form) {
    var input = form && form.querySelector('input[name="_csrf"]');
    return input ? input.value : "";
  }

  // ---------------------------------------------------------- generic

  function initFocus() {
    var target = $('[data-autofocus="true"]');
    if (target) target.focus();
  }

  function initSubmitOnce() {
    $$("form[data-submit-once]").forEach(function (form) {
      form.addEventListener("submit", function () {
        var btn = form.querySelector('button[type="submit"]');
        if (!btn) return;
        btn.disabled = true;
        if (btn.dataset.busyLabel) btn.textContent = btn.dataset.busyLabel;
      });
    });
  }

  function initConfirm() {
    $$("form[data-confirm]").forEach(function (form) {
      form.addEventListener("submit", function (e) {
        if (!window.confirm(form.dataset.confirm)) {
          e.preventDefault();
          return;
        }
        var btn = form.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
      });
    });
  }

  function initCopy() {
    $$("[data-copy]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var value = btn.dataset.copy;
        var done = function () {
          btn.dataset.copied = "true";
          announce("렌더링 URL을 복사했습니다");
          setTimeout(function () {
            delete btn.dataset.copied;
          }, 2000);
        };
        var fail = function () {
          var source = $('[data-copy-source="' + btn.dataset.copyTarget + '"]:not([tabindex="-1"])');
          if (source) {
            source.focus();
            source.select();
          }
          $$("[data-copy-fallback]").forEach(function (el) {
            el.hidden = false;
          });
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(done, fail);
        } else {
          fail();
        }
      });
    });
  }

  // Drop the one-shot ?saved banner flag so reloads do not show it again.
  function initCleanUrl() {
    var url = new URL(window.location.href);
    if (url.searchParams.has("saved") || url.searchParams.has("deleted")) {
      url.searchParams.delete("saved");
      url.searchParams.delete("replaced");
      url.searchParams.delete("deleted");
      history.replaceState(null, "", url.pathname + (url.search ? url.search : ""));
    }
  }

  // ---------------------------------------------------------- HTML checks

  function decodeHtml(buffer) {
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(buffer), converted: false };
    } catch (e) {
      var text = new TextDecoder("euc-kr").decode(buffer);
      text = text.replace(/(<meta[^>]+charset\s*=\s*["']?)(euc-kr|ks_c_5601-1987|cp949)/gi, "$1utf-8");
      return { text: text, converted: true };
    }
  }

  var RESOURCE_ATTR = /<(img|script|link|source|video|audio)\b[^>]*?\s(src|href)\s*=\s*(["'])(.*?)\3/gi;
  var ABSOLUTE = /^(https?:|data:|blob:|\/\/|#|mailto:)/i;

  // Heuristic only; false positives/negatives are accepted (design.md 4.6).
  function findWarnings(html) {
    var relative = [];
    var insecure = [];
    var m;
    RESOURCE_ATTR.lastIndex = 0;
    while ((m = RESOURCE_ATTR.exec(html))) {
      var tag = m[1].toLowerCase();
      var value = m[4].trim();
      if (!value) continue;
      if (tag === "link" && !/rel\s*=\s*["']?(stylesheet|icon|preload|modulepreload)/i.test(m[0])) continue;
      if (/^http:/i.test(value)) insecure.push(value);
      else if (!ABSOLUTE.test(value)) relative.push(value);
    }
    var unique = function (list) {
      return list.filter(function (v, i) {
        return list.indexOf(v) === i;
      });
    };
    return { relative: unique(relative), insecure: unique(insecure) };
  }

  function examples(list) {
    var shown = list.slice(0, 3).join(", ");
    return list.length > 3 ? shown + " 외 " + (list.length - 3) + "개" : shown;
  }

  function extractTitle(html) {
    var m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (!m) return "";
    var el = document.createElement("textarea");
    el.innerHTML = m[1];
    return el.value.replace(/\s+/g, " ").trim().slice(0, 200);
  }

  // ---------------------------------------------------------- document form

  function initDocumentForm() {
    var form = $("form[data-doc-form]");
    if (!form) return;
    var isEdit = form.dataset.mode === "edit";
    var section = $("[data-html-input]", form.ownerDocument);
    var zone = section && $("[data-dropzone]", section);
    var fileInput = zone && $("#html-file", zone);
    var paste = zone && $("#html-paste", zone);
    var msg = zone && $("[data-dz-msg]", zone);
    var uploadIdInput = $("[data-upload-id]", form);
    var titleInput = $("#title", form);
    var titleHint = $("[data-title-hint]", form);
    var submitBtn = $("[data-submit]", form);
    var submitError = $("[data-submit-error]", form);
    var replaceNote = $("[data-replace-note]");
    var info = $("[data-info]");
    var warnings = $("[data-warnings]");
    var warningList = $("[data-warning-list]");

    var html = null; // decoded HTML waiting to be uploaded
    var titleAutofilled = false;

    function setState(state, message) {
      zone.dataset.state = state;
      msg.textContent = message || "";
    }
    function setPending(text) {
      html = text;
      uploadIdInput.value = "";
      if (replaceNote) replaceNote.hidden = !text;
    }
    function showWarnings(text) {
      warningList.innerHTML = "";
      if (!text) {
        warnings.hidden = true;
        return;
      }
      var found = findWarnings(text);
      var items = [];
      if (found.relative.length)
        items.push([
          "이 파일만 올라가므로 함께 있던 이미지·스크립트 파일은 표시되지 않습니다. 이미지를 HTML 안에 포함(base64)해서 다시 만들어 주세요.",
          found.relative,
        ]);
      if (found.insecure.length)
        items.push(["보안 연결(https)이 아닌 리소스는 브라우저가 차단합니다.", found.insecure]);
      items.forEach(function (item) {
        var li = document.createElement("li");
        li.textContent = item[0] + " ";
        var ex = document.createElement("span");
        ex.className = "font-mono text-xs break-all";
        ex.textContent = "예: " + examples(item[1]);
        li.appendChild(ex);
        warningList.appendChild(li);
      });
      warnings.hidden = items.length === 0;
    }
    function autofillTitle(text, fallbackName) {
      if (!titleInput || (titleInput.value.trim() && !titleAutofilled)) return;
      var title = extractTitle(text) || fallbackName || "";
      if (!title) return;
      titleInput.value = title;
      titleAutofilled = true;
      if (titleHint) titleHint.hidden = false;
    }
    if (titleInput)
      titleInput.addEventListener("input", function () {
        titleAutofilled = false;
        if (titleHint) titleHint.hidden = true;
      });

    function clearSelection(note) {
      if (fileInput) fileInput.value = "";
      setPending(null);
      info.hidden = true;
      showWarnings(null);
      setState("empty", note);
    }

    function handleFile(file) {
      if (!/\.html?$/i.test(file.name)) {
        setPending(null);
        return setState("error", "HTML 파일(.html, .htm)만 올릴 수 있습니다.");
      }
      if (file.size > MAX_BYTES) {
        setPending(null);
        return setState(
          "error",
          "10MB를 넘는 파일은 올릴 수 없습니다. (선택한 파일: " +
            formatSize(file.size) +
            ") 이미지가 많이 들어 있다면 이미지 크기를 줄여 다시 만들어 주세요.",
        );
      }
      if (file.size === 0) {
        setPending(null);
        return setState("error", "파일 내용이 비어 있습니다. 다른 파일을 선택해 주세요.");
      }
      setState("reading");
      file.arrayBuffer().then(function (buffer) {
        var decoded = decodeHtml(buffer);
        if (decoded.text.indexOf("\u0000") !== -1) {
          setPending(null);
          return setState("error", "HTML 파일이 아닌 것 같습니다. 다른 파일을 선택해 주세요.");
        }
        setPending(decoded.text);
        info.hidden = !decoded.converted;
        showWarnings(decoded.text);
        $("[data-file-name]", zone).textContent = file.name;
        $("[data-file-size]", zone).textContent = formatSize(file.size);
        setState("selected");
        announce(file.name + " 파일을 선택했습니다");
        if (!isEdit) autofillTitle(decoded.text, file.name.replace(/\.html?$/i, ""));
      });
    }

    if (zone) {
      fileInput.addEventListener("change", function () {
        if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
      });

      // Accept drops anywhere on the page: a missed drop would make the
      // browser navigate to the file and lose the form (ui.md SCR-03).
      var dragDepth = 0;
      window.addEventListener("dragenter", function (e) {
        if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types, "Files") === -1) return;
        dragDepth++;
        if (zone.dataset.mode !== "paste") zone.dataset.state = "dragover";
      });
      window.addEventListener("dragleave", function () {
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0 && zone.dataset.state === "dragover") zone.dataset.state = html ? "selected" : "empty";
      });
      window.addEventListener("dragover", function (e) {
        e.preventDefault();
      });
      window.addEventListener("drop", function (e) {
        e.preventDefault();
        dragDepth = 0;
        if (zone.dataset.mode === "paste") return;
        var files = e.dataTransfer && e.dataTransfer.files;
        if (!files || files.length === 0) return setState(html ? "selected" : "empty");
        if (files.length > 1) return setState("error", "파일은 하나만 올릴 수 있습니다.");
        handleFile(files[0]);
      });

      $("[data-file-clear]", zone).addEventListener("click", function () {
        clearSelection("");
        fileInput.focus();
      });

      $$("[data-mode-radio]", section).forEach(function (radio) {
        radio.addEventListener("change", function () {
          var hadContent = !!html || !!uploadIdInput.value;
          zone.dataset.mode = radio.value;
          paste.value = "";
          $("[data-paste-size]", zone).textContent = "";
          clearSelection(
            hadContent ? (radio.value === "paste" ? "파일 선택을 해제했습니다." : "붙여넣은 내용을 지웠습니다.") : "",
          );
          zone.dataset.mode = radio.value;
          if (radio.value === "paste") paste.focus();
        });
      });

      var pasteTimer = null;
      paste.addEventListener("input", function () {
        clearTimeout(pasteTimer);
        pasteTimer = setTimeout(function () {
          var text = paste.value;
          var bytes = new TextEncoder().encode(text).length;
          $("[data-paste-size]", zone).textContent = text ? "붙여넣은 내용 · " + formatSize(bytes) : "";
          if (bytes > MAX_BYTES) {
            setPending(null);
            return setState("error", "10MB를 넘는 내용은 올릴 수 없습니다.");
          }
          setState("empty");
          setPending(text.trim() ? text : null);
          showWarnings(text.trim() ? text : null);
          if (text.trim() && !isEdit) autofillTitle(text, "");
        }, 500);
      });
    }

    // Two-step save: raw bytes to PUT /uploads, then the small form with
    // upload_id (design.md 4.3).
    var submitting = false;
    form.addEventListener("submit", function (e) {
      if (submitting) return e.preventDefault();
      if (zone && zone.dataset.mode === "paste" && paste.value.trim() && html !== paste.value) {
        setPending(paste.value);
      }
      var needsHtml = !isEdit && !uploadIdInput.value;
      if (!html) {
        if (needsHtml) {
          e.preventDefault();
          setState("error", "HTML 파일을 올리거나 코드를 붙여넣어 주세요.");
          (zone.dataset.mode === "paste" ? paste : fileInput).focus();
        }
        return;
      }
      e.preventDefault();
      submitting = true;
      submitBtn.disabled = true;
      $("[data-busy-icon]", submitBtn).hidden = false;
      $("[data-submit-label]", submitBtn).textContent = "저장하는 중…";
      submitError.hidden = true;

      fetch("/uploads", {
        method: "PUT",
        headers: { "Content-Type": "text/html; charset=utf-8", "X-CSRF-Token": csrfToken(form) },
        body: new TextEncoder().encode(html),
        credentials: "same-origin",
      })
        .then(function (res) {
          return res.json().then(function (data) {
            if (!res.ok || !data.uploadId) throw new Error(data.error || "upload_failed");
            return data;
          });
        })
        .then(function (data) {
          uploadIdInput.value = String(data.uploadId);
          HTMLFormElement.prototype.submit.call(form);
        })
        .catch(function (err) {
          submitting = false;
          submitBtn.disabled = false;
          $("[data-busy-icon]", submitBtn).hidden = true;
          $("[data-submit-label]", submitBtn).textContent = "저장";
          if (err.message === "too_large") {
            setState("error", "10MB를 넘는 파일은 올릴 수 없습니다.");
          } else {
            submitError.hidden = false;
            submitError.focus && submitError.focus();
          }
        });
    });

    initLinks(form);
  }

  function initLinks(form) {
    var list = $("[data-link-list]", form);
    var template = $("[data-link-template]", form);
    var addBtn = $("[data-link-add]", form);
    var limitNote = $("[data-link-limit]", form);
    if (!list || !template || !addBtn) return;

    function rows() {
      return $$("[data-link-row]", list);
    }
    function renumber() {
      rows().forEach(function (row, i) {
        var n = i + 1;
        $('input[name="link_label"]', row).setAttribute("aria-label", "링크 " + n + " 이름");
        $('input[name="link_url"]', row).setAttribute("aria-label", "링크 " + n + " 주소");
        $("[data-link-remove]", row).setAttribute("aria-label", "링크 " + n + " 삭제");
      });
      var full = rows().length >= MAX_LINKS;
      addBtn.disabled = full;
      limitNote.hidden = !full;
    }
    function bind(row) {
      $("[data-link-remove]", row).addEventListener("click", function () {
        var all = rows();
        if (all.length === 1) {
          $$("input", row).forEach(function (input) {
            input.value = "";
          });
          $('input[name="link_label"]', row).focus();
          return;
        }
        var next = all[all.indexOf(row) + 1];
        row.remove();
        renumber();
        if (next) $('input[name="link_label"]', next).focus();
        else addBtn.focus();
      });
    }
    rows().forEach(bind);
    addBtn.addEventListener("click", function () {
      if (rows().length >= MAX_LINKS) return;
      var row = template.content.firstElementChild.cloneNode(true);
      list.appendChild(row);
      bind(row);
      renumber();
      $('input[name="link_label"]', row).focus();
    });
    renumber();
  }

  document.addEventListener("DOMContentLoaded", function () {
    initFocus();
    initSubmitOnce();
    initConfirm();
    initCopy();
    initCleanUrl();
    initDocumentForm();
  });
})();
