// Hide the additional console window in Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lime_workbench_lib::run();
}
