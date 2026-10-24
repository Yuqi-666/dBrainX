// SPDX-License-Identifier: AGPL-3.0-only

use serde_json::Value;
use std::{fs::{self, OpenOptions}, io::Write, path::PathBuf, process::{Child, Command, Stdio}, sync::Mutex, time::{Duration, Instant}};
use tauri::{AppHandle, Manager, State};

pub struct LocalBackend {
    runtime_dir: PathBuf,
    data_dir: PathBuf,
    process: Option<Child>,
    descriptor: Option<Value>,
}

impl LocalBackend {
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let mut runtime_dir = if cfg!(debug_assertions) {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("runtime")
        } else { app.path().resource_dir()?.join("runtime") };
        // Tauri 2.10 RPM/AppImage place resources under productName; DEB uses package.name.
        #[cfg(target_os = "linux")]
        if !runtime_dir.is_dir() && !cfg!(debug_assertions) {
            let executable = std::env::current_exe()?;
            if let Some(parent) = executable.parent() {
                let product = app.config().product_name.as_deref().unwrap_or("dBrainX");
                let candidate = parent.join("../lib").join(product).join("runtime");
                if candidate.is_dir() { runtime_dir = candidate.canonicalize()?; }
            }
        }
        Ok(Self { runtime_dir, data_dir: app.path().app_local_data_dir()?, process: None, descriptor: None })
    }

    fn start(&mut self) -> Result<Value, String> {
        if let Some(child) = self.process.as_mut() {
            if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                if let Some(descriptor) = &self.descriptor { return Ok(descriptor.clone()); }
                self.stop();
            } else { self.process = None; self.descriptor = None; }
        }
        fs::create_dir_all(&self.data_dir).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&self.data_dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?; }
        let ready = self.data_dir.join(format!("backend-ready-{}.json", std::process::id()));
        let _ = fs::remove_file(&ready);
        let log = OpenOptions::new().create(true).append(true).open(self.data_dir.join("backend.log")).map_err(|e| e.to_string())?;
        let exe = |name: &str| self.runtime_dir.join(if cfg!(windows) { format!("{name}.exe") } else { name.into() });
        let mut command = Command::new(exe("node"));
        command.arg(self.runtime_dir.join("backend.mjs")).arg(&self.data_dir).arg(&ready)
            .env("DBRAINX_DESKTOP", "1")
            .env("FFMPEG_PATH", exe("ffmpeg")).env("FFPROBE_PATH", exe("ffprobe"))
            .stdin(Stdio::piped()).stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?)).stderr(Stdio::from(log));
        #[cfg(target_os = "linux")]
        command.env("LD_LIBRARY_PATH", self.runtime_dir.join("lib"));
        #[cfg(windows)]
        { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
        self.process = Some(command.spawn().map_err(|e| format!("无法启动本地后端：{e}"))?);
        let deadline = Instant::now() + Duration::from_secs(45);
        while Instant::now() < deadline {
            if let Some(status) = self.process.as_mut().unwrap().try_wait().map_err(|e| e.to_string())? {
                self.process = None;
                return Err(format!("本地后端启动失败（{status}），请查看 {}", self.data_dir.join("backend.log").display()));
            }
            if let Ok(bytes) = fs::read(&ready) {
                let descriptor: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                self.descriptor = Some(descriptor.clone());
                return Ok(descriptor);
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        self.stop();
        Err("本地后端启动超时，请查看应用数据目录中的 backend.log".into())
    }

    pub fn stop(&mut self) {
        if let Some(mut child) = self.process.take() {
            if let Some(mut input) = child.stdin.take() { let _ = input.write_all(b"shutdown\n"); }
            let deadline = Instant::now() + Duration::from_secs(5);
            while Instant::now() < deadline {
                if matches!(child.try_wait(), Ok(Some(_))) { break; }
                std::thread::sleep(Duration::from_millis(50));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
        self.descriptor = None;
    }
}

#[tauri::command]
pub async fn start_local_backend(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state: State<'_, Mutex<LocalBackend>> = app.state();
        let result = state.lock().map_err(|e| e.to_string())?.start();
        result
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supervisor_starts_reuses_stops_and_restarts_packaged_backend() {
        let data_dir = std::env::temp_dir().join(format!("dbrainx-native-supervisor-test-{}", std::process::id()));
        assert!(!data_dir.exists(), "Test directory must be fresh");
        let mut backend = LocalBackend {
            runtime_dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("runtime"),
            data_dir: data_dir.clone(), process: None, descriptor: None,
        };
        let first = backend.start().expect("packaged backend starts");
        assert!(first["trpc"].as_str().unwrap().starts_with("ws://127.0.0.1:"));
        assert_eq!(first, backend.start().expect("reuses live backend"));
        let identity = fs::read(data_dir.join("local-identity.json")).unwrap();
        backend.stop();
        assert!(!data_dir.join("runtime.lock").exists(), "shutdown reaps database process");
        let second = backend.start().expect("backend restarts");
        assert_ne!(first["pocketbase"], second["pocketbase"]);
        assert_eq!(identity, fs::read(data_dir.join("local-identity.json")).unwrap());
        backend.stop();
        assert!(backend.process.is_none());
        fs::remove_dir_all(data_dir).unwrap();
    }
}

impl Drop for LocalBackend {
    fn drop(&mut self) { self.stop(); }
}
