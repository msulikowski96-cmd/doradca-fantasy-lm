// Ekran logowania i zakładania konta (konta w Supabase, src/cloud.js).
import { $, esc } from "./dom.js";

const view = { tab: "login", msg: "", busy: false, info: "" };

/**
 * Rysuje ekran kont w `el`.
 * opts = { cloud, onSignedIn(), onLocal(), hasLocalData }
 */
export function renderAuth(el, opts) {
  const reg = view.tab === "register";
  el.innerHTML = `
    <div class="card auth">
      <div class="seg" role="tablist" aria-label="Konto">
        <button type="button" role="tab" id="authTabLogin" aria-selected="${!reg}">Logowanie</button>
        <button type="button" role="tab" id="authTabRegister" aria-selected="${reg}">Nowe konto</button>
      </div>
      <h2>${reg ? "Załóż konto" : "Zaloguj się"}</h2>
      <p class="small muted">${reg
        ? "Twój skład, historia i plany zapiszą się w chmurze – zobaczysz je na każdym telefonie. Admin ligi widzi składy i punkty wszystkich."
        : "Zaloguj się, żeby mieć swój skład na każdym urządzeniu i grać w lidze znajomych."}</p>
      <form id="authForm" class="stack" novalidate>
        ${reg ? `<label class="f" for="authName">Nazwa w lidze<input type="text" id="authName" autocomplete="nickname" maxlength="40" placeholder="np. Mati"></label>` : ""}
        <label class="f" for="authEmail">E-mail<input type="email" id="authEmail" autocomplete="email" inputmode="email" required></label>
        <label class="f" for="authPass">Hasło${reg ? ' <span class="hint">co najmniej 8 znaków</span>' : ""}<input type="password" id="authPass" autocomplete="${reg ? "new-password" : "current-password"}" minlength="8" required></label>
        <div class="actions"><button class="btn primary" id="authSubmit" type="submit" ${view.busy ? "disabled" : ""}>${view.busy ? "Chwilka…" : reg ? "Załóż konto" : "Zaloguj"}</button></div>
      </form>
      ${view.msg ? `<div class="notice" id="authMsg">${esc(view.msg)}</div>` : ""}
      ${view.info ? `<div class="notice info" id="authInfo">${esc(view.info)}</div>` : ""}
      ${!reg ? `<p class="small muted">Nie pamiętasz hasła? Poproś admina ligi – ustawi Ci nowe.</p>` : ""}
    </div>
    <div class="card">
      <p class="small muted">Możesz też korzystać bez konta – dane zostaną tylko w tej przeglądarce${opts.hasLocalData ? " (masz tu już zapisany skład)" : ""}. Konto założysz później w zakładce Zasady.</p>
      <div class="actions"><button class="btn ghost" id="authLocal" type="button">Używaj bez konta</button></div>
    </div>`;

  $("#authTabLogin").addEventListener("click", () => { view.tab = "login"; view.msg = ""; view.info = ""; renderAuth(el, opts); });
  $("#authTabRegister").addEventListener("click", () => { view.tab = "register"; view.msg = ""; view.info = ""; renderAuth(el, opts); });
  $("#authLocal").addEventListener("click", () => opts.onLocal());
  $("#authForm").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("#authEmail").value.trim(), password = $("#authPass").value;
    const name = reg ? $("#authName").value.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { view.msg = "Wpisz poprawny adres e-mail."; renderAuth(el, opts); return; }
    if (password.length < 8) { view.msg = "Hasło musi mieć co najmniej 8 znaków."; renderAuth(el, opts); return; }
    if (reg && !name) { view.msg = "Wpisz nazwę, pod którą będziesz w rankingu."; renderAuth(el, opts); return; }
    view.busy = true; view.msg = ""; view.info = ""; renderAuth(el, opts);
    try {
      if (reg) {
        const r = await opts.cloud.signUp({ email, password, name });
        if (r.needsConfirm) {
          view.busy = false; view.tab = "login";
          view.info = "Konto założone, ale czeka na potwierdzenie e-maila. Kliknij link w wiadomości albo poproś admina o aktywację.";
          renderAuth(el, opts); return;
        }
      } else {
        await opts.cloud.signIn({ email, password });
      }
      view.busy = false; view.msg = "";
      await opts.onSignedIn();
    } catch (err) {
      view.busy = false; view.msg = (err && err.message) || "Coś poszło nie tak. Spróbuj ponownie.";
      renderAuth(el, opts);
      // Pola wracają z wpisanym e-mailem, żeby nie wpisywać go od nowa.
      const em = $("#authEmail"); if (em) em.value = email;
      const nm = $("#authName"); if (nm) nm.value = name;
    }
  });
}
