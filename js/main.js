// Top-level tabs, form section slides, and submission form for the Foil House bulk site.
// Depends on SITE_CONFIG from config.js and Slide from slide.js.

const formSlides = [
  new Slide("intro", "Start here", "slides/intro.html"),
  new Slide("you", "You", "slides/you.html"),
  new Slide("shipping-address", "Ship-from address", "slides/shipping-address.html"),
  new Slide("cards", "Your cards", "slides/cards.html"),
  new Slide("condition", "Condition", "slides/condition.html"),
  new Slide("details", "Additional details", "slides/details.html"),
  new Slide("photos", "Photos to attach", "slides/photos.html"),
  new Slide("confirm", "Confirm", "slides/confirm.html"),
];

const tabs = [
  new Slide("form", "Bulk submission", null),
  new Slide("shipping", "Shipping help", "slides/shipping.html"),
  new Slide("info", "About the program", "slides/info.html"),
];

const $ = (id) => document.getElementById(id);
let activeTab = 0;
let activeFormSlide = 0;
let renderVersion = 0;
const formDraft = {};

function tabIndexFromHash() {
  const requested = (location.hash || "#form").slice(1);
  const index = tabs.findIndex((tab) => tab.id === requested);
  return index === -1 ? 0 : index;
}

async function loadSlideHtml(slide) {
  const response = await fetch(slide.html);
  if (!response.ok) {
    throw new Error(`Unable to load slide: ${slide.html}`);
  }
  return response.text();
}

function showLoadError() {
  $("content").innerHTML = `
    <section>
      <h2>Unable to load this section</h2>
      <p class="muted">Please reload the page and try again.</p>
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
  $("next").disabled = Boolean($("f") && !$("f").checkValidity());
}

async function renderFormSlide() {
  saveFormDraft();
  const version = ++renderVersion;
  const slide = formSlides[activeFormSlide];

  try {
    const html = await loadSlideHtml(slide);
    if (version !== renderVersion) return;
    $("content").innerHTML = `
      <section id="form">
        <form id="f" class="slide-form">
          <div class="slide-box">
            <h2>${slide.title}</h2>
            ${html}
          </div>
        </form>
        <div id="out" class="card">
          <p>
            <b>Your email should have opened.</b> Attach your photos and send
            it. If nothing opened, copy this and email it with your photos to
            <span id="to"></span>:
          </p>
          <textarea id="txt" readonly></textarea>
          <p style="margin-top: 12px"><button class="btn" id="copy" type="button">Copy details</button></p>
        </div>
      </section>
    `;
    restoreFormDraft();
    formNavigation();
    bindFormControls();
    document.title = `Foil House | ${slide.title}`;
  } catch (error) {
    if (version === renderVersion) showLoadError();
    console.error(error);
  }
}

async function renderTab() {
  if (activeTab === 0) {
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

function buildSubmissionText(data) {
  const get = (key) => (data.get(key) || formDraft[key] || "").toString().trim();
  const contents = formDraft.kind?.join(", ") || "not specified";

  return [
    "NEW BULK SUBMISSION",
    "",
    `Name: ${get("name")}`,
    `Email: ${get("email")}`,
    `PayPal: ${get("paypal")}`,
    `Phone: ${get("phone") || "-"}`,
    "",
    `Ship from: ${get("street")}, ${get("city")}, ${get("state").toUpperCase()} ${get("zip")}`,
    "",
    `Approx. cards: ${get("count")}`,
    `Est. weight (lbs): ${get("weight")}`,
    `Contents: ${contents}`,
    `Condition: ${get("condition") || "-"}`,
    `Hoping for: ${get("ask") || "-"}`,
    `Notes: ${get("notes") || "-"}`,
    "",
    "Confirmed: cards are mine to sell, I'm 18+, I agree to the program policy.",
    "(Photos attached to this email.)",
  ].join("\n");
}

function handleSubmit(event) {
  event.preventDefault();
  saveFormDraft();
  const data = new FormData(event.target);
  const body = buildSubmissionText(data);
  const name = (formDraft.name || "").toString().trim();
  const subject = `Bulk submission - ${name}`;

  $("txt").value = body;
  $("out").style.display = "block";

  location.href =
    `mailto:${SITE_CONFIG.submissionEmail}` +
    `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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

$("back").addEventListener("click", () => navigateFormSlide(activeFormSlide - 1));
$("next").addEventListener("click", () => {
  if (activeFormSlide === formSlides.length - 1) {
    $("f").requestSubmit();
    return;
  }
  navigateFormSlide(activeFormSlide + 1);
});
window.addEventListener("hashchange", showTab);
showTab();
