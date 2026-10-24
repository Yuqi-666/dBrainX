// SPDX-License-Identifier: AGPL-3.0-only

mod local_backend;
use local_backend::{LocalBackend, start_local_backend};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

async fn update_on_start(app: tauri::AppHandle) -> tauri_plugin_updater::Result<()> {
  if let Some(update) = app.updater()?.check().await? {
    log::info!("New dBrainX release available: {}", update.version);
    update.download_and_install(|_, _| {}, || {}).await?;
    app.restart();
  }
  Ok(())
}

fn themed_icon(theme: tauri::Theme) -> tauri::image::Image<'static> {
  match theme {
    tauri::Theme::Dark => tauri::include_image!("icons/logo-dark.png"),
    _ => tauri::include_image!("icons/logo-light.png"),
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    .setup(|app| {
      app.manage(Mutex::new(LocalBackend::new(app.handle())?));
      app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
      if !cfg!(debug_assertions) {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
          if let Err(error) = update_on_start(handle).await {
            log::warn!("Release check or installation failed: {error}");
          }
        });
      }
      for window in app.webview_windows().values() {
        window.set_icon(themed_icon(window.theme().unwrap_or(tauri::Theme::Light)))?;
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build(),
        )?;
      }
      Ok(())
    })
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::ThemeChanged(theme) = event {
        if let Err(error) = window.set_icon(themed_icon(*theme)) {
          log::warn!("Could not update the window icon: {error}");
        }
      }
    })
    .invoke_handler(tauri::generate_handler![start_local_backend])
    .build(tauri::generate_context!())
    .expect("error while building tauri application");
  app.run(|app, event| {
    if matches!(event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
      if let Ok(mut backend) = app.state::<Mutex<LocalBackend>>().lock() { backend.stop(); }
    }
  });
}
