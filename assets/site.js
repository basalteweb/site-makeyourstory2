document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector("[data-menu-toggle]");
  const menu = document.querySelector("[data-mobile-menu]");
  if (toggle && menu) {
    toggle.addEventListener("click", () => {
      const open = menu.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
    });
    menu.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
      menu.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Ouvrir le menu");
    }));
  }

  const selectedOffer = new URLSearchParams(window.location.search).get("offre");
  document.querySelectorAll("select[name='Offre choisie']").forEach(select => {
    if (!selectedOffer) return;
    const target = selectedOffer.toLowerCase();
    [...select.options].forEach(opt => {
      if (opt.value.toLowerCase().includes(target)) select.value = opt.value;
    });
  });

  const copyToClipboard = async (value) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const helper = document.createElement("textarea");
    helper.value = value;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  };

  document.querySelectorAll("[data-share]").forEach(button => {
    button.addEventListener("click", async () => {
      const title = button.dataset.shareTitle || document.title;
      const text = button.dataset.shareText || "Découvre cette annonce créée avec MakeYourStory.";
      const url = button.dataset.shareUrl || window.location.href;
      const original = button.innerHTML;
      try {
        if (navigator.share) {
          await navigator.share({ title, text, url });
        } else {
          await copyToClipboard(url);
          button.textContent = "Lien copié ✓";
          window.setTimeout(() => { button.innerHTML = original; }, 2500);
        }
      } catch (error) {
        if (error && error.name === "AbortError") return;
        try {
          await copyToClipboard(url);
          button.textContent = "Lien copié ✓";
          window.setTimeout(() => { button.innerHTML = original; }, 2500);
        } catch (_) {
          button.textContent = "Partage indisponible";
          window.setTimeout(() => { button.innerHTML = original; }, 2500);
        }
      }
    });
  });

  const accessForm = document.querySelector("[data-access-form]");
  if (accessForm) {
    accessForm.addEventListener("submit", event => {
      event.preventDefault();
      const code = (accessForm.querySelector("input[name='code']").value || "").trim().toUpperCase();
      const msg = accessForm.querySelector("[data-access-message]");
      const urls = {
        "DEMO": "faire-parts.html",
        "DEMO-NAISSANCE": "faire-part-naissance.html#demo",
        "DEMO-MARIAGE": "invitation-mariage.html#demo",
        "DEMO-ANNIVERSAIRE": "invitation-anniversaire.html#demo",
        "DEMO-HOMMAGE": "annonce-deces.html#demo",
        "DEMO-ALBUM": "album-emotion.html#demo",
        "DEMO-LOVE": "stories/demo/index.html"
      };
      if (urls[code]) { window.location.href = urls[code]; return; }
      msg.textContent = "Ce code ne correspond pas à une histoire disponible. Vérifiez le code reçu avec votre lien.";
    });
  }
});