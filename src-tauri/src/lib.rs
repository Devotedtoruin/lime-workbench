// Keep the native surface minimal: no custom commands, file access or shell plugins.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to run Lime Workbench");
}
