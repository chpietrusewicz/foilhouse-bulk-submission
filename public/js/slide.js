// A confirmation message can be attached to a slide's next action later.
class ConfirmationMessage {
  constructor(message, title = "Please confirm", confirmLabel = "Continue", cancelLabel = "Cancel") {
    this.title = title;
    this.message = message;
    this.confirmLabel = confirmLabel;
    this.cancelLabel = cancelLabel;
  }
}

// A slide stores its identity, heading, path to an HTML partial, and optional confirmation.
class Slide {
  constructor(id, title, html, confirmation = null) {
    this.id = id;
    this.title = title;
    this.html = html;
    this.confirmation = confirmation;
  }
}