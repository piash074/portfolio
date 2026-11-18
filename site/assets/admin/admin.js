(function () {
  "use strict";

  var page = document.body.dataset.adminPage;
  var csrfCookieName = "portfolio_csrf";

  function cookieValue(name) {
    var match = document.cookie.match(
      new RegExp("(?:^|;\\s*)" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"),
    );
    return match ? match[1] : "";
  }

  function csrfToken() {
    return cookieValue(csrfCookieName);
  }

  function requestJson(path, options) {
    var settings = options || {};
    var headers = Object.assign({ Accept: "application/json" }, settings.headers);
    if (settings.body !== undefined) headers["Content-Type"] = "application/json";
    if (settings.method && settings.method !== "GET") {
      headers["X-CSRF-Token"] = csrfToken();
    }
    return fetch(path, Object.assign({
      credentials: "same-origin",
      headers: headers,
    }, settings)).then(function (response) {
      return response.json().catch(function () {
        return null;
      }).then(function (body) {
        if (response.status === 401 && page !== "login") {
          window.location.replace("/admin/login");
          throw new Error("Your session has expired. Sign in again.");
        }
        if (!response.ok || !body || body.ok !== true) {
          var error = new Error(body && body.error ? body.error : "request_failed");
          error.status = response.status;
          throw error;
        }
        return body;
      });
    });
  }

  function displayDate(value) {
    var date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "Date unavailable"
      : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
  }

  function initials(name) {
    return name.trim().split(/\s+/).slice(0, 2).map(function (part) {
      return part.charAt(0);
    }).join("").toUpperCase() || "?";
  }

  function createElement(tag, className, value) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }

  function showError(element, error, fallback) {
    element.textContent = fallback || "Something went wrong. Please try again.";
    element.hidden = false;
    if (error && error.status === 401) {
      element.textContent = "Your session has expired. Redirecting to sign in…";
    }
  }

  function guard() {
    return requestJson("/api/auth/session").then(function (session) {
      if (!session.authenticated) {
        if (page !== "login") window.location.replace("/admin/login");
        return false;
      }
      document.querySelectorAll("#admin-email").forEach(function (element) {
        element.textContent = session.admin && session.admin.email
          ? session.admin.email
          : "Signed in";
      });
      return true;
    }).catch(function () {
      if (page !== "login") window.location.replace("/admin/login");
      return false;
    });
  }

  function setupLogin() {
    var form = document.getElementById("login-form");
    var password = document.getElementById("password");
    var toggle = document.getElementById("password-toggle");
    var submit = document.getElementById("login-submit");
    var errorMessage = document.getElementById("login-error");
    var busy = false;

    guard().then(function (authenticated) {
      if (authenticated) window.location.replace("/admin/dashboard");
    });

    toggle.addEventListener("click", function () {
      var visible = password.type === "password";
      password.type = visible ? "text" : "password";
      toggle.textContent = visible ? "Hide" : "Show";
      toggle.setAttribute("aria-label", visible ? "Hide password" : "Show password");
      toggle.setAttribute("aria-pressed", String(visible));
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (busy) return;
      errorMessage.hidden = true;
      if (!form.reportValidity()) return;

      busy = true;
      submit.disabled = true;
      submit.setAttribute("aria-busy", "true");
      submit.querySelector("span").textContent = "Signing in…";
      fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          email: form.elements.email.value.trim(),
          password: form.elements.password.value,
        }),
      }).then(function (response) {
        return response.json().catch(function () {
          return null;
        }).then(function (body) {
          if (!response.ok || !body || body.ok !== true) {
            var error = new Error(body && body.error ? body.error : "login_failed");
            error.status = response.status;
            throw error;
          }
          window.location.replace("/admin/dashboard");
        });
      }).catch(function (error) {
        if (error.status === 401) {
          errorMessage.textContent = "The email or password is incorrect.";
        } else if (error.status === 429) {
          errorMessage.textContent = "Too many attempts. Please wait before trying again.";
        } else if (error.status === 503) {
          errorMessage.textContent = "Sign in is temporarily unavailable. Please try again later.";
        } else {
          errorMessage.textContent = "Unable to sign in. Check your connection and try again.";
        }
        errorMessage.hidden = false;
      }).then(function () {
        busy = false;
        submit.disabled = false;
        submit.removeAttribute("aria-busy");
        submit.querySelector("span").textContent = "Sign in";
      });
    });
  }

  function setupLogout() {
    document.querySelectorAll(".logout-button").forEach(function (button) {
      button.addEventListener("click", function () {
        button.disabled = true;
        requestJson("/api/auth/logout", {
          method: "POST",
          body: "{}",
        }).then(function () {
          window.location.replace("/admin/login");
        }).catch(function () {
          button.disabled = false;
          window.alert("You could not be signed out. Please try again.");
        });
      });
    });
  }

  function setupDashboard() {
    var errorElement = document.getElementById("dashboard-error");
    return requestJson("/api/admin/dashboard").then(function (data) {
      document.getElementById("admin-email").textContent =
        data.admin && data.admin.email ? data.admin.email : "Signed in";
      document.getElementById("total-count").textContent = String(data.stats.total);
      document.getElementById("unread-count").textContent = String(data.stats.unread);
      document.getElementById("read-count").textContent = String(data.stats.read);
      var container = document.getElementById("recent-messages");
      container.replaceChildren();
      if (!data.recentMessages.length) {
        var empty = createElement("div", "empty-state");
        empty.appendChild(createElement("strong", "", "Your inbox is clear"));
        empty.appendChild(createElement("span", "", "New contact messages will appear here."));
        container.appendChild(empty);
        return;
      }
      data.recentMessages.forEach(function (message) {
        var link = createElement("a", "recent-row");
        link.href = "/admin/inbox";
        var main = createElement("span", "recent-main");
        main.appendChild(createElement("span", "sender-avatar", initials(message.name)));
        var copy = createElement("span", "sender-copy");
        copy.appendChild(createElement("strong", "", message.name));
        copy.appendChild(createElement("span", "", message.service + " · " + message.email));
        main.appendChild(copy);
        var meta = createElement("span", "row-meta");
        meta.appendChild(createElement(
          "span",
          message.unread ? "status-badge unread" : "status-badge",
          message.unread ? "Unread" : "Read",
        ));
        meta.appendChild(createElement("time", "", displayDate(message.createdAt)));
        link.appendChild(main);
        link.appendChild(meta);
        container.appendChild(link);
      });
    }).catch(function (error) {
      showError(errorElement, error, "Could not load dashboard data. Please refresh to try again.");
      document.getElementById("recent-messages").replaceChildren(
        createElement("p", "error-state", "Recent messages are unavailable."),
      );
    });
  }

  function setupInbox() {
    var list = document.getElementById("message-list");
    var errorElement = document.getElementById("inbox-error");
    var search = document.getElementById("message-search");
    var filter = document.getElementById("message-filter");
    var sort = document.getElementById("message-sort");
    var pagination = document.getElementById("pagination");
    var pageLabel = document.getElementById("page-label");
    var previous = document.getElementById("prev-page");
    var next = document.getElementById("next-page");
    var dialog = document.getElementById("message-dialog");
    var dialogError = document.getElementById("dialog-error");
    var state = { page: 1, pages: 0, activeMessage: null, requestId: 0 };
    var debounce;

    function queryString() {
      var params = new URLSearchParams({
        page: String(state.page),
        limit: "20",
        search: search.value.trim(),
        filter: filter.value,
        sort: sort.value,
      });
      return params.toString();
    }

    function renderMessage(message) {
      var row = createElement("article", "message-row");
      var open = createElement("button", "message-open");
      open.type = "button";
      open.appendChild(createElement("span", "sender-avatar", initials(message.name)));
      var copy = createElement("span", "message-copy");
      var title = createElement("span", "message-title");
      title.appendChild(createElement("strong", "", message.name));
      if (message.unread) title.appendChild(createElement("span", "status-badge unread", "Unread"));
      copy.appendChild(title);
      copy.appendChild(createElement("span", "message-subject", message.service));
      copy.appendChild(createElement("span", "message-email", message.email));
      copy.appendChild(createElement("span", "message-preview", message.preview || ""));
      open.appendChild(copy);
      open.addEventListener("click", function () {
        loadMessage(message.id);
      });
      var side = createElement("div", "message-side");
      side.appendChild(createElement("time", "message-date", displayDate(message.createdAt)));
      if (!message.unread) side.appendChild(createElement("span", "status-badge", "Read"));
      row.appendChild(open);
      row.appendChild(side);
      list.appendChild(row);
    }

    function loadList() {
      var requestId = ++state.requestId;
      errorElement.hidden = true;
      list.replaceChildren(createElement("p", "loading-state", "Loading messages…"));
      return requestJson("/api/admin/messages?" + queryString()).then(function (data) {
        if (requestId !== state.requestId) return;
        list.replaceChildren();
        document.getElementById("message-total").textContent = String(data.total);
        state.pages = data.pages;
        if (!data.messages.length) {
          var empty = createElement("div", "empty-state");
          empty.appendChild(createElement(
            "strong",
            "",
            search.value.trim() ? "No messages match your search" : "No messages here yet",
          ));
          empty.appendChild(createElement(
            "span",
            "",
            search.value.trim()
              ? "Try a different sender, email address or keyword."
              : filter.value === "all"
                ? "Contact requests will appear here when they arrive."
                : "There are no messages in this view.",
          ));
          list.appendChild(empty);
        } else {
          data.messages.forEach(renderMessage);
        }
        pagination.hidden = data.pages <= 1;
        pageLabel.textContent = data.pages
          ? "Page " + data.page + " of " + data.pages + " · " + data.total + " messages"
          : "No messages";
        previous.disabled = data.page <= 1;
        next.disabled = data.page >= data.pages;
      }).catch(function (error) {
        if (requestId !== state.requestId) return;
        list.replaceChildren(createElement("p", "error-state", "Messages could not be loaded."));
        showError(errorElement, error, "Could not load messages. Please try again.");
        pagination.hidden = true;
      });
    }

    function loadMessage(id) {
      dialogError.hidden = true;
      dialog.showModal();
      document.getElementById("dialog-name").textContent = "Loading message…";
      document.getElementById("dialog-service").textContent = "";
      document.getElementById("dialog-email").textContent = "";
      document.getElementById("dialog-date").textContent = "";
      document.getElementById("dialog-message").textContent = "";
      requestJson("/api/admin/messages/" + encodeURIComponent(id)).then(function (data) {
        var message = data.message;
        state.activeMessage = message;
        document.getElementById("dialog-name").textContent = message.name;
        document.getElementById("dialog-service").textContent = message.service;
        document.getElementById("dialog-email").textContent = message.email;
        document.getElementById("dialog-date").textContent = displayDate(message.createdAt);
        document.getElementById("dialog-message").textContent = message.message;
        var badge = document.getElementById("dialog-status");
        badge.className = message.unread ? "status-badge unread" : "status-badge";
        badge.textContent = message.unread ? "Unread" : "Read";
        document.getElementById("dialog-read").textContent = message.unread
          ? "Mark as read"
          : "Mark as unread";
      }).catch(function (error) {
        showError(dialogError, error, "This message could not be loaded.");
      });
    }

    document.getElementById("dialog-close").addEventListener("click", function () {
      dialog.close();
    });
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) dialog.close();
    });
    document.getElementById("dialog-read").addEventListener("click", function (event) {
      if (!state.activeMessage) return;
      var button = event.currentTarget;
      button.disabled = true;
      requestJson("/api/admin/messages/" + encodeURIComponent(state.activeMessage.id), {
        method: "PATCH",
        body: JSON.stringify({ unread: !state.activeMessage.unread }),
      }).then(function () {
        state.activeMessage.unread = !state.activeMessage.unread;
        dialog.close();
        loadList();
      }).catch(function (error) {
        showError(dialogError, error, "The read status could not be updated.");
      }).then(function () {
        button.disabled = false;
      });
    });
    document.getElementById("dialog-delete").addEventListener("click", function (event) {
      if (!state.activeMessage) return;
      if (!window.confirm("Delete this message permanently? This cannot be undone.")) return;
      var button = event.currentTarget;
      button.disabled = true;
      requestJson("/api/admin/messages/" + encodeURIComponent(state.activeMessage.id), {
        method: "DELETE",
      }).then(function () {
        dialog.close();
        loadList();
      }).catch(function (error) {
        showError(dialogError, error, "The message could not be deleted.");
      }).then(function () {
        button.disabled = false;
      });
    });
    search.addEventListener("input", function () {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(function () {
        state.page = 1;
        loadList();
      }, 250);
    });
    filter.addEventListener("change", function () {
      state.page = 1;
      loadList();
    });
    sort.addEventListener("change", function () {
      state.page = 1;
      loadList();
    });
    previous.addEventListener("click", function () {
      if (state.page > 1) {
        state.page -= 1;
        loadList();
      }
    });
    next.addEventListener("click", function () {
      if (state.page < state.pages) {
        state.page += 1;
        loadList();
      }
    });
    loadList();
  }

  if (page === "login") {
    setupLogin();
    return;
  }
  guard().then(function (authenticated) {
    if (!authenticated) return;
    setupLogout();
    if (page === "dashboard") setupDashboard();
    if (page === "inbox") setupInbox();
  });
})();
