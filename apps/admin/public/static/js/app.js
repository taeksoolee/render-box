// render-box admin behaviour. Only toggles data-*/aria-*/hidden/disabled
// attributes; styling reacts through Tailwind variants (docs/ui.md §0).
(function () {
  "use strict";

  var MAX_BYTES = 10 * 1024 * 1024;
  var MAX_LINKS = 10;
  var UNREADABLE =
    "파일을 읽지 못했습니다. 선택한 뒤에 파일이 수정·이동되었거나, iCloud·구글 드라이브처럼 내 컴퓨터에 내려받지 않은 파일일 수 있습니다. 파일을 다시 선택해 주세요.";

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
      else if (!ABSOLUTE.test(value) && tag !== "img") relative.push(value);
    }
    var unique = function (list) {
      return list.filter(function (v, i) {
        return list.indexOf(v) === i;
      });
    };
    return { relative: unique(relative), insecure: unique(insecure) };
  }

  // Local <img src> paths outside scripts and comments. Values built by script
  // (<img src="${url}"> in a template string) are not files to ask for.
  var NOT_MARKUP = /<script\b[\s\S]*?<\/script\s*>|<!--[\s\S]*?-->/gi;
  var IMG_TAG = /<img\b[^>]*>/gi;
  var SRC_ATTR = /(\ssrc\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
  var TEMPLATE = /\$\{|\{\{|<%/;

  function mapMarkup(html, fn) {
    var out = "";
    var last = 0;
    var m;
    NOT_MARKUP.lastIndex = 0;
    while ((m = NOT_MARKUP.exec(html))) {
      out += fn(html.slice(last, m.index)) + m[0];
      last = NOT_MARKUP.lastIndex;
    }
    return out + fn(html.slice(last));
  }
  function localSrc(tag) {
    var m = SRC_ATTR.exec(tag);
    if (!m) return null;
    var value = (m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]).trim();
    return value && !ABSOLUTE.test(value) && !TEMPLATE.test(value) ? value : null;
  }
  function findLocalImages(html) {
    var found = [];
    mapMarkup(html, function (part) {
      (part.match(IMG_TAG) || []).forEach(function (tag) {
        var src = localSrc(tag);
        if (src && found.indexOf(src) === -1) found.push(src);
      });
      return part;
    });
    return found;
  }
  function inlineImages(html, dataUrls) {
    return mapMarkup(html, function (part) {
      return part.replace(IMG_TAG, function (tag) {
        var src = localSrc(tag);
        if (!src || !dataUrls[src]) return tag;
        return tag.replace(SRC_ATTR, function (_, prefix) {
          return prefix + '"' + dataUrls[src] + '"';
        });
      });
    });
  }
  // "./img/Logo.png?v=2" and a picked file "logo.png" belong together.
  function baseName(src) {
    var path = src.split(/[?#]/)[0];
    try {
      path = decodeURIComponent(path);
    } catch (e) {}
    return path.split(/[\\/]/).pop().toLowerCase();
  }
  // Grey box standing in for an image nobody supplied; shows the file name so
  // the planning intent ("a logo goes here") still reads.
  function placeholderUrl(src) {
    var name = baseName(src).replace(/[&<>"']/g, function (c) {
      return "&#" + c.charCodeAt(0) + ";";
    });
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">' +
      '<rect width="400" height="300" fill="#e5e7eb"/>' +
      '<text x="200" y="150" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" ' +
      'font-size="16" fill="#6b7280">' + name + "</text></svg>";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  function readDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        var err = new Error("unreadable");
        err.file = file;
        reject(err);
      };
      reader.readAsDataURL(file);
    });
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
    var images = $("[data-images]");
    var imageList = images && $("[data-image-list]", images);
    var imageMsg = images && $("[data-image-msg]", images);
    var imageSrcs = []; // local <img src> paths in html
    var imageFiles = {}; // src -> File chosen for it

    function setImageFile(src, file) {
      if (!/^image\//.test(file.type)) {
        imageMsg.textContent = file.name + "은(는) 이미지 파일이 아닙니다.";
        return false;
      }
      imageFiles[src] = file;
      return true;
    }
    function renderImages() {
      if (!images) return;
      imageList.innerHTML = "";
      imageMsg.textContent = "";
      var template = $("[data-image-template]", images);
      imageSrcs.forEach(function (src) {
        var row = template.content.firstElementChild.cloneNode(true);
        var file = imageFiles[src];
        var input = $("[data-image-file]", row);
        row.dataset.state = file ? "selected" : "missing";
        $("[data-image-src]", row).textContent = src;
        $("[data-image-status]", row).textContent = file
          ? file.name + " · " + formatSize(file.size)
          : "선택하지 않으면 빈 상자로 표시됩니다";
        $("[data-image-action]", row).textContent = file ? "바꾸기" : "파일 선택";
        input.setAttribute("aria-label", src + " 이미지 파일 선택");
        input.addEventListener("change", function () {
          if (input.files && input.files[0] && setImageFile(src, input.files[0])) {
            renderImages();
            announce(src + "에 " + input.files[0].name + " 파일을 연결했습니다");
          }
        });
        imageList.appendChild(row);
      });
      var skipped = imageSrcs.filter(function (src) {
        return !imageFiles[src];
      }).length;
      $("[data-image-summary]", images).textContent =
        "이미지 " + imageSrcs.length + "개 중 " + (imageSrcs.length - skipped) + "개 선택" +
        (skipped ? " · 나머지 " + skipped + "개는 빈 상자로 표시됩니다" : "");
      images.hidden = imageSrcs.length === 0;
    }
    function updateImages(text) {
      imageSrcs = text ? findLocalImages(text) : [];
      Object.keys(imageFiles).forEach(function (src) {
        if (imageSrcs.indexOf(src) === -1) delete imageFiles[src];
      });
      renderImages();
    }
    // Several image files at once: connect each to the paths with its name.
    function matchImages(files) {
      var unmatched = [];
      Array.prototype.forEach.call(files, function (file) {
        var hit = false;
        imageSrcs.forEach(function (src) {
          if (baseName(src) === file.name.toLowerCase() && setImageFile(src, file)) hit = true;
        });
        if (!hit) unmatched.push(file.name);
      });
      renderImages();
      var connected = files.length - unmatched.length;
      announce("이미지 " + connected + "개를 연결했습니다");
      if (unmatched.length)
        imageMsg.textContent = "이름이 맞는 경로가 없어 연결하지 못한 파일: " + unmatched.join(", ");
    }
    if (images)
      $("[data-image-bulk]", images).addEventListener("change", function (e) {
        if (e.target.files && e.target.files.length) matchImages(e.target.files);
        e.target.value = "";
      });

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
      updateImages(text);
      warningList.innerHTML = "";
      if (!text) {
        warnings.hidden = true;
        return;
      }
      var found = findWarnings(text);
      var items = [];
      if (found.relative.length)
        items.push([
          "이 파일만 올라가므로 함께 있던 스크립트·스타일 파일은 동작하지 않습니다. HTML 안에 포함해서 다시 만들어 주세요.",
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
      return file.arrayBuffer().then(function (buffer) {
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
      }, function () {
        // NotReadableError: the file changed or moved after it was picked, or
        // it is a cloud-drive placeholder that is not on this disk.
        if (fileInput) fileInput.value = "";
        setPending(null);
        setState("error", UNREADABLE);
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
        var htmlFiles = [];
        var imageDrops = [];
        Array.prototype.forEach.call(files, function (f) {
          (/\.html?$/i.test(f.name) ? htmlFiles : imageDrops).push(f);
        });
        if (htmlFiles.length > 1) return setState("error", "HTML 파일은 하나만 올릴 수 있습니다.");
        if (htmlFiles.length === 0) {
          if (imageSrcs.length) {
            setState(html ? "selected" : "empty");
            return matchImages(imageDrops);
          }
          return handleFile(files[0]);
        }
        var read = handleFile(htmlFiles[0]);
        if (read && imageDrops.length)
          read.then(function () {
            if (imageSrcs.length) matchImages(imageDrops);
          });
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
        showWarnings(paste.value);
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
      function resetSubmit() {
        submitting = false;
        submitBtn.disabled = false;
        $("[data-busy-icon]", submitBtn).hidden = true;
        $("[data-submit-label]", submitBtn).textContent = "저장";
      }

      Promise.all(
        imageSrcs.map(function (src) {
          return imageFiles[src] ? readDataUrl(imageFiles[src]) : placeholderUrl(src);
        }),
      )
        .then(function (urls) {
          var dataUrls = {};
          imageSrcs.forEach(function (src, i) {
            dataUrls[src] = urls[i];
          });
          var body = new TextEncoder().encode(imageSrcs.length ? inlineImages(html, dataUrls) : html);
          if (body.length > MAX_BYTES) {
            var err = new Error("too_large_inlined");
            err.size = body.length;
            throw err;
          }
          return fetch("/uploads", {
            method: "PUT",
            headers: { "Content-Type": "text/html; charset=utf-8", "X-CSRF-Token": csrfToken(form) },
            body: body,
            credentials: "same-origin",
          });
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
          resetSubmit();
          if (err.message === "unreadable") {
            Object.keys(imageFiles).forEach(function (src) {
              if (imageFiles[src] === err.file) delete imageFiles[src];
            });
            renderImages();
            imageMsg.textContent = err.file.name + " " + UNREADABLE;
            $("[data-image-bulk]", images).focus();
          } else if (err.message === "too_large_inlined") {
            imageMsg.textContent =
              "이미지를 넣으니 10MB를 넘습니다. (" + formatSize(err.size) + ") 이미지 크기를 줄여서 다시 선택해 주세요.";
            $("[data-image-bulk]", images).focus();
          } else if (err.message === "too_large") {
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
