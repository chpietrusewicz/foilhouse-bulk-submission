// Top-level tabs, form section slides, and submission form for the Foil House bulk site.
// Depends on SITE_CONFIG from config.js and Slide from slide.js.

const formSlides = [
  new Slide("intro", "Start here", "/slides/intro.html"),
  new Slide("cards", "Your cards", "/slides/cards.html",
    new ConfirmationMessage(
      "Please verify card counts are accurate, the final amount will be verified when we receive your shipment",
      "Ready to continue?",
      "Continue",
      "Keep editing",
    ),
  ),
  new Slide("you", "Information", "/slides/you.html"),
  new Slide("shipping-address", "Ship-from address", "/slides/shipping-address.html"),
  new Slide("confirm", "Confirm", "/slides/confirm.html"),
  new Slide("summary", "Estimated payout", "/slides/summary.html"),
];

const tabs = [
  new Slide("home", "Home", null),
  new Slide("form", "Bulk submission", null),
  new Slide("shipping", "Shipping help", "/slides/shipping.html"),
  new Slide("info", "About the program", "/slides/info.html"),
];

const $ = (id) => document.getElementById(id);
let activeTab = 0;
let activeFormSlide = 0;
let renderVersion = 0;
const formDraft = {};
const MAX_PHOTOS = 10;
const MAX_CARD_ENTRIES = 4;
let cardEntries = [
  { count: "", type: "", photos: [] },
];

function tabIndexFromHash() {
  const requested = (location.hash || "#home").slice(1);
  const index = tabs.findIndex((tab) => tab.id === requested);
  return index === -1 ? 0 : index;
}

const submissionStatuses = [
  "pending review",
  "pending user approval",
  "pending user edit",
  "waiting user shipment",
  "waiting for shipment",
  "Foilhouse card review",
  "paid",
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatSubmissionDate(value) {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
}

function statusOptions(selected) {
  return submissionStatuses
    .map((status) => `<option value="${escapeHtml(status)}" ${status === selected ? "selected" : ""}>${escapeHtml(status)}</option>`)
    .join("");
}

function submissionCards(submissions, admin = false) {
  if (!submissions.length) return `<p class="empty-state">No submissions yet.</p>`;

  return `<div class="submission-list">${submissions
    .map(
      (submission) => `
        <article class="submission-item">
          <div>
            <h3>${escapeHtml(admin ? submission.name : `Submission ${submission.id}`)}</h3>
            <p class="muted">${admin ? `${escapeHtml(submission.email)} · ` : ""}${formatSubmissionDate(submission.receivedAt)} · ${Number(submission.count || 0).toLocaleString()} cards</p>
          </div>
          <div class="submission-status">
            ${admin
              ? `<label>Status<select class="status-select" data-submission-id="${escapeHtml(submission.id)}">${statusOptions(submission.status)}</select></label>`
              : `<span class="status-label">${escapeHtml(submission.status)}</span>`}
          </div>
        </article>
      `,
    )
    .join("")}</div>`;
}

async function fetchSubmissions(url) {
  const response = await fetch(url);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not load submissions.");
  return result.submissions;
}

async function renderHome() {
  try {
    const submissions = await fetchSubmissions("/api/submissions");
    $("content").innerHTML = `
      <section class="account-home">
        <div class="account-heading">
          <div><p class="eyebrow">Account</p><h1>My submissions</h1></div>
          <button class="btn" id="new-submission" type="button">Add submission</button>
        </div>
        ${submissionCards(submissions)}
      </section>
    `;
    $("new-submission").onclick = () => { window.location.hash = "#form"; };
    $("form-navigation").style.display = "none";
    document.title = "Foil House | My submissions";
  } catch (error) {
    showLoadError(error.message);
  }
}

async function renderAdmin() {
  try {
    const submissions = await fetchSubmissions("/api/admin/submissions");
    $("content").innerHTML = `
      <section class="account-home admin-home">
        <div class="account-heading">
          <div><p class="eyebrow">Admin</p><h1>All submissions</h1></div>
          <button class="btn" id="admin-home" type="button">My submissions</button>
        </div>
        ${submissionCards(submissions, true)}
      </section>
    `;
    $("admin-home").onclick = () => { window.location.hash = "#home"; };
    document.querySelectorAll(".status-select").forEach((select) => {
      select.addEventListener("change", async () => {
        select.disabled = true;
        const response = await fetch(`/api/admin/submissions/${encodeURIComponent(select.dataset.submissionId)}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: select.value }),
        });
        if (!response.ok) {
          select.disabled = false;
          showLoadError("The submission status could not be updated.");
          return;
        }
        select.disabled = false;
      });
    });
    $("form-navigation").style.display = "none";
    document.title = "Foil House | All submissions";
  } catch (error) {
    showLoadError(error.message);
  }
}

async function loadSlideHtml(slide) {
  const response = await fetch(slide.html);
  if (!response.ok) {
    throw new Error(`Unable to load slide: ${slide.html}`);
  }
  return response.text();
}

function showLoadError(message = "Please reload the page and try again.") {
  $("content").innerHTML = `
    <section>
      <h2>Unable to load your submissions</h2>
      <p class="muted">${escapeHtml(message)}</p>
    </section>
  `;
  $("form-navigation").style.display = "none";
}

function saveFormDraft() {
  const form = $("f");
  if (!form) return;
  for (const control of form.elements) {
    if (!control.name) continue;
    if (control.type === "checkbox") {
      if (!formDraft[control.name]) formDraft[control.name] = [];
      if (control.checked && !formDraft[control.name].includes(control.value)) {
        formDraft[control.name].push(control.value);
      }
      if (!control.checked) {
        formDraft[control.name] = formDraft[control.name].filter(
          (value) => value !== control.value,
        );
      }
    } else {
      formDraft[control.name] = control.value;
    }
  }
}

function restoreFormDraft() {
  const form = $("f");
  if (!form) return;
  for (const control of form.elements) {
    if (!control.name || formDraft[control.name] === undefined) continue;
    if (control.type === "checkbox") {
      control.checked = formDraft[control.name].includes(control.value);
    } else {
      control.value = formDraft[control.name];
    }
  }
}

function formNavigation() {
  $("form-navigation").style.display = "grid";
  $("back").disabled = activeFormSlide === 0;
  $("next").textContent = activeFormSlide === formSlides.length - 1 ? "Submit" : "Next";
  $("next").classList.toggle("submit-btn", activeFormSlide === formSlides.length - 1);
  $("progress").textContent = `${activeFormSlide + 1} of ${formSlides.length}`;
  updateNextState();
}

function updateNextState() {
  const formInvalid = $("f") && !$("f").checkValidity();
  const cardsIncomplete =
    formSlides[activeFormSlide].id === "cards" &&
    !cardEntries.every((entry) => {
      const count = Number(entry.count);
      return Number.isInteger(count) && count > 0 && entry.type && entry.photos.length > 0;
    });
  $("next").disabled = Boolean(formInvalid || cardsIncomplete);
}

function allCardPhotos() {
  return cardEntries.flatMap((entry) => entry.photos);
}

function renderRates() {
  const list = $("rate-list");
  if (!list) return;
  list.innerHTML = "";
  SITE_CONFIG.rates.forEach(({ type, rate }) => {
    const item = document.createElement("li");
    const typeLabel = document.createElement("span");
    const rateLabel = document.createElement("strong");
    typeLabel.textContent = type;
    rateLabel.textContent = rate;
    item.append(typeLabel, rateLabel);
    list.append(item);
  });
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function estimatedApprovalDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
  }).format(date);
}

function renderSummary() {
  const body = $("summary-rows");
  const totalCards = cardEntries.reduce((total, entry) => total + Number(entry.count || 0), 0);
  if (!body) return;

  const entriesByType = new Map();
  cardEntries.forEach((entry) => {
    const count = Number(entry.count || 0);
    if (!entry.type || !count) return;
    const existing = entriesByType.get(entry.type) || 0;
    entriesByType.set(entry.type, existing + count);
  });

  let cardPayout = 0;
  body.innerHTML = Array.from(entriesByType.entries())
    .map(([type, count]) => {
      const rate = SITE_CONFIG.rates.find((item) => item.type === type);
      const subtotal = rate.unit === "thousand"
        ? (count / 1000) * rate.amount
        : count * rate.amount;
      cardPayout += subtotal;
      return `<tr><th scope="row">${type}</th><td>${count.toLocaleString()}</td><td>${rate.rate}</td><td>${formatCurrency(subtotal)}</td></tr>`;
    })
    .join("");

  const shipping = (totalCards / 1000) * SITE_CONFIG.shippingRate;
  $("summary-shipping").textContent = formatCurrency(shipping);
  $("summary-total").textContent = formatCurrency(cardPayout + shipping);
  $("summary-approval-date").textContent = estimatedApprovalDate();
}

function renderCardEntries() {
  const container = $("card-entries");
  if (!container) return;

  container.innerHTML = cardEntries
    .map(
      (entry, index) => `
        <div class="card-entry" data-entry-index="${index}">
          <label>Number of cards<input class="card-count" type="number" min="1" value="${entry.count}" required /></label>
          <label>Type
            <select class="card-type" required>
              <option value="" disabled ${!entry.type ? "selected" : ""}>Choose a type</option>
              ${SITE_CONFIG.rates
                .map(
                  ({ type }) =>
                    `<option ${entry.type === type ? "selected" : ""}>${type}</option>`,
                )
                .join("")}
            </select>
          </label>
          <label class="photo-picker" title="Add card photos">
            <span class="photo-plus" aria-hidden="true">+</span>
            <span>Add photos</span>
            <input class="photo-input" type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple />
          </label>
          <div class="photo-previews" aria-live="polite">
            ${entry.photos
              .map(
                (file, photoIndex) => `
                  <span class="photo-preview">
                    <img src="${URL.createObjectURL(file)}" alt="Selected card photo" />
                    <button class="photo-remove" type="button" data-photo-index="${photoIndex}" aria-label="Remove ${file.name}">×</button>
                  </span>
                `,
              )
              .join("")}
          </div>
          <button class="remove-entry" type="button" aria-label="Remove card entry">Remove</button>
        </div>
      `,
    )
    .join("");

  $("add-card-entry").hidden = cardEntries.length >= MAX_CARD_ENTRIES;

  container.querySelectorAll(".card-entry").forEach((row) => {
    const index = Number(row.dataset.entryIndex);
    row.querySelector(".card-count").addEventListener("input", (event) => {
      cardEntries[index].count = event.target.value;
      updateNextState();
    });
    row.querySelector(".card-type").addEventListener("change", (event) => {
      cardEntries[index].type = event.target.value;
      updateNextState();
    });
    row.querySelector(".photo-input").addEventListener("change", (event) => {
      const available = MAX_PHOTOS - allCardPhotos().length;
      cardEntries[index].photos.push(...Array.from(event.target.files).slice(0, available));
      renderCardEntries();
      updateNextState();
    });
    row.querySelectorAll(".photo-remove").forEach((button) => {
      button.addEventListener("click", () => {
        cardEntries[index].photos.splice(Number(button.dataset.photoIndex), 1);
        renderCardEntries();
        updateNextState();
      });
    });
    row.querySelector(".remove-entry").addEventListener("click", () => {
      if (cardEntries.length === 1) return;
      cardEntries.splice(index, 1);
      renderCardEntries();
      updateNextState();
    });
  });

  $("add-card-entry").onclick = () => {
    if (cardEntries.length >= MAX_CARD_ENTRIES) return;
    cardEntries.push({ count: "", type: "", photos: [] });
    renderCardEntries();
    updateNextState();
  };
}

async function renderFormSlide() {
  saveFormDraft();
  const version = ++renderVersion;
  const slide = formSlides[activeFormSlide];

  try {
    const html = await loadSlideHtml(slide);
    if (version !== renderVersion) return;
    $("content").innerHTML = `
      <section id="form" class="form-slide-${slide.id}">
        <form id="f" class="slide-form">
          <div class="slide-box">
            <h2>${slide.title}</h2>
            ${html}
          </div>
        </form>
        <div id="out" class="card">
          <p>
            <b>Your submission is ready.</b> Your photos and details will be
            sent securely for review.
          </p>
          <textarea id="txt" readonly></textarea>
          <p style="margin-top: 12px"><button class="btn" id="copy" type="button">Copy status</button></p>
        </div>
      </section>
    `;
    restoreFormDraft();
    renderCardEntries();
    renderRates();
    renderSummary();
    formNavigation();
    bindFormControls();
    document.title = `Foil House | ${slide.title}`;
  } catch (error) {
    if (version === renderVersion) showLoadError();
    console.error(error);
  }
}

async function renderTab() {
  if (tabs[activeTab].id === "home") {
    await renderHome();
    return;
  }
  if (tabs[activeTab].id === "form") {
    await renderFormSlide();
    return;
  }

  const version = ++renderVersion;
  const tab = tabs[activeTab];

  try {
    const html = await loadSlideHtml(tab);
    if (version !== renderVersion) return;
    $("content").innerHTML = `<section id="${tab.id}"><h2>${tab.title}</h2>${html}</section>`;
    $("form-navigation").style.display = "none";
    document.title = `Foil House | ${tab.title}`;
    window.scrollTo(0, 0);
  } catch (error) {
    if (version === renderVersion) showLoadError();
    console.error(error);
  }
}

function showTab() {
  saveFormDraft();
  if (location.hash === "#admin") {
    renderAdmin();
    return;
  }
  activeTab = tabIndexFromHash();
  renderTab();
}

function navigateFormSlide(index) {
  saveFormDraft();
  if (index > activeFormSlide && $("f") && !$('f').reportValidity()) return;
  activeFormSlide = Math.max(0, Math.min(index, formSlides.length - 1));
  renderFormSlide();
  window.scrollTo(0, 0);
}

function bindFormControls() {
  if ($("f")) $("f").addEventListener("submit", handleSubmit);
  if ($("f")) {
    $("f").addEventListener("input", updateNextState);
    $("f").addEventListener("change", updateNextState);
  }
  if ($("copy")) $("copy").addEventListener("click", copyDetails);
  if ($("to")) $("to").textContent = SITE_CONFIG.submissionEmail;
}

/* ---------- Submission form ---------- */

function buildSubmissionFormData() {
  const submission = new FormData();
  const fields = [
    "name",
    "email",
    "phone",
    "street",
    "city",
    "state",
    "zip",
    "condition",
    "ask",
    "notes",
  ];

  fields.forEach((field) => submission.append(field, formDraft[field] || ""));
  submission.append(
    "count",
    cardEntries.reduce((total, entry) => total + Number(entry.count || 0), 0),
  );
  cardEntries.forEach((entry) => submission.append("kind", entry.type));
  submission.append("confirmOwner", formDraft.confirmOwner?.[0] || "");
  submission.append("confirmPolicy", formDraft.confirmPolicy?.[0] || "");
  allCardPhotos().forEach((file) => submission.append("photos", file));
  return submission;
}

async function handleSubmit(event) {
  event.preventDefault();
  saveFormDraft();
  $("out").style.display = "block";
  $("out").querySelector("b").textContent = "Sending your submission...";

  try {
    const response = await fetch("/api/submissions", {
      method: "POST",
      body: buildSubmissionFormData(),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The submission failed.");
    $("out").querySelector("b").textContent = "Submission received.";
    $("txt").value = `Your submission ID is ${result.id}. We will review it and follow up by email.`;
    window.location.hash = "#home";
  } catch (error) {
    $("out").querySelector("b").textContent = "We could not send your submission.";
    $("txt").value = error.message;
  }
  $("out").scrollIntoView({ behavior: "smooth" });
}

function copyDetails() {
  const box = $("txt");
  box.select();
  try {
    navigator.clipboard.writeText(box.value);
  } catch (err) {
    document.execCommand("copy");
  }
}

function requestConfirmation(confirmation) {
  if (!confirmation) return Promise.resolve(true);

  const modal = $("confirmation-modal");
  const title = $("confirmation-title");
  const message = $("confirmation-message");
  const cancel = $("confirmation-cancel");
  const accept = $("confirmation-accept");
  const previousFocus = document.activeElement;

  title.textContent = confirmation.title;
  message.textContent = confirmation.message;
  cancel.textContent = confirmation.cancelLabel;
  accept.textContent = confirmation.confirmLabel;
  modal.hidden = false;
  accept.focus();

  return new Promise((resolve) => {
    const finish = (confirmed) => {
      modal.hidden = true;
      cancel.onclick = null;
      accept.onclick = null;
      window.removeEventListener("keydown", handleKeydown);
      if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
      resolve(confirmed);
    };
    const handleKeydown = (event) => {
      if (event.key === "Escape") finish(false);
    };
    cancel.onclick = () => finish(false);
    accept.onclick = () => finish(true);
    window.addEventListener("keydown", handleKeydown);
  });
}

async function handleNext() {
  const slide = formSlides[activeFormSlide];
  if (!(await requestConfirmation(slide.confirmation))) return;
  if (activeFormSlide === formSlides.length - 1) {
    $("f").requestSubmit();
    return;
  }
  navigateFormSlide(activeFormSlide + 1);
}

$("back").addEventListener("click", () => navigateFormSlide(activeFormSlide - 1));
$("next").addEventListener("click", handleNext);
window.addEventListener("hashchange", showTab);
window.addEventListener("auth-ready", showTab);
if (window.authUser) showTab();
