export function createApp() {
  document.title = 'Kana Trainer';

  const app = document.createElement('main');
  app.className = 'app-shell';
  app.setAttribute('aria-label', 'Kana Trainer app shell');
  app.innerHTML = `
    <div class="app-shell__frame">
      <section class="hero" aria-labelledby="hero-title">
        <p class="hero__eyebrow">Static starter shell</p>
        <h1 id="hero-title">Kana Trainer</h1>
        <p class="hero__copy" data-shell-copy>
          Practice hiragana and katakana with a calm, focused workspace that is ready for future lessons.
        </p>
      </section>

      <section class="panel" aria-label="Training controls">
        <div data-mode="kana-to-sound">
          <span class="panel__title">Mode</span>
          <p class="panel__body">Kana to sound</p>
        </div>
        <div data-script="hiragana">
          <span class="panel__title">Script</span>
          <p class="panel__body">Hiragana</p>
        </div>
      </section>

      <section class="panel" data-region="prompt" aria-label="Prompt region">
        <p class="panel__title">Prompt</p>
        <p class="panel__body">Prompt content will be rendered here.</p>
      </section>

      <section class="panel" data-region="progress" aria-label="Progress region">
        <p class="panel__title">Progress</p>
        <p class="panel__body">Progress content will be rendered here.</p>
      </section>
    </div>
  `;

  return app;
}
