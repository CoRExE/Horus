use crate::download_support::write_error;
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Download {
    pub id: String,
    pub metadata: serde_json::Value,
    pub size_bytes: u64,
    pub downloaded_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<PathBuf>,
    #[serde(default = "available_default")]
    pub available: bool,
}
fn available_default() -> bool {
    true
}
fn valid_id(id: &str) -> Result<String, String> {
    Uuid::parse_str(id)
        .map(|id| id.to_string())
        .map_err(|_| "Identifiant invalide".into())
}
fn stored_path(root: &Path, item: &Download) -> Result<PathBuf, String> {
    let id = valid_id(&item.id)?;
    let name = format!("{id}.mp4");
    let path = item.file_path.clone().unwrap_or_else(|| root.join(&name));
    if !path.is_absolute() || path.file_name().is_none_or(|f| f != name.as_str()) {
        return Err("Emplacement du téléchargement invalide".into());
    }
    Ok(path)
}
pub fn path_for(root: &Path, id: &str) -> Result<PathBuf, String> {
    let id = valid_id(id)?;
    let bytes = fs::read(root.join(format!("{id}.json")))
        .map_err(|_| "Téléchargement introuvable. Vérifiez que son disque est connecté.")?;
    let item: Download =
        serde_json::from_slice(&bytes).map_err(|_| "Métadonnées du téléchargement invalides")?;
    if item.id != id {
        return Err("Identifiant du téléchargement incohérent".into());
    }
    stored_path(root, &item)
}
pub fn directory(root: &Path) -> Result<PathBuf, String> {
    match fs::read(root.join("destination.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| {
            "Configuration du dossier invalide. Enregistrez de nouveau un dossier.".into()
        }),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(root.to_path_buf()),
        Err(_) => Err("Impossible de lire la configuration du dossier de destination".into()),
    }
}
pub fn set_directory(root: &Path, requested: Option<String>) -> Result<PathBuf, String> {
    let directory = requested
        .map(PathBuf::from)
        .unwrap_or_else(|| root.to_path_buf());
    if !directory.is_absolute() || !directory.is_dir() {
        return Err("Choisissez le chemin absolu d’un dossier existant et accessible.".into());
    }
    let directory = fs::canonicalize(directory).map_err(write_error)?;
    let probe = directory.join(format!(".horus-write-test-{}", Uuid::new_v4()));
    let file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .map_err(write_error)?;
    drop(file);
    fs::remove_file(probe).map_err(write_error)?;
    let bytes = serde_json::to_vec(&directory).map_err(|e| e.to_string())?;
    fs::write(root.join("destination.json.part"), bytes).map_err(write_error)?;
    fs::rename(
        root.join("destination.json.part"),
        root.join("destination.json"),
    )
    .map_err(write_error)?;
    Ok(directory)
}
// A central journal owns only this UUID's files, even for an external destination.
// It allows cleanup after a crash without scanning or deleting unrelated files.
pub fn begin(root: &Path, id: &str, metadata: serde_json::Value) -> Result<Download, String> {
    let id = valid_id(id)?;
    if root.join(format!("{id}.json")).exists() || root.join(format!("{id}.pending")).exists() {
        return Err("Identifiant déjà utilisé".into());
    }
    let destination = directory(root)?;
    if !destination.is_absolute() || !destination.is_dir() {
        return Err("Dossier de destination introuvable. Rebranchez le disque ou choisissez un autre dossier.".into());
    }
    let file = destination.join(format!("{id}.mp4"));
    let partial = file.with_extension("part");
    if file.exists() || partial.exists() {
        return Err("Identifiant déjà utilisé".into());
    }
    let item = Download {
        id: id.clone(),
        metadata,
        size_bytes: 0,
        downloaded_at: 0,
        file_path: Some(file),
        available: true,
    };
    let bytes = serde_json::to_vec(&item).map_err(|e| e.to_string())?;
    fs::write(root.join(format!("{id}.pending")), bytes).map_err(write_error)?;
    if let Err(e) = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)
    {
        let _ = fs::remove_file(root.join(format!("{id}.pending")));
        return Err(write_error(e));
    }
    Ok(item)
}
pub fn commit(root: &Path, item: &Download) -> Result<(), String> {
    let path = stored_path(root, item)?;
    fs::rename(path.with_extension("part"), &path).map_err(write_error)?;
    let partial = root.join(format!("{}.json.part", item.id));
    fs::write(
        &partial,
        serde_json::to_vec(item).map_err(|e| e.to_string())?,
    )
    .map_err(write_error)?;
    fs::rename(partial, root.join(format!("{}.json", item.id))).map_err(write_error)?;
    let _ = fs::remove_file(root.join(format!("{}.pending", item.id)));
    Ok(())
}
fn remove_if_present(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}
pub fn rollback(root: &Path, item: &Download) {
    let Ok(path) = stored_path(root, item) else {
        return;
    };
    // Keep the journal while an external volume is disconnected or cleanup fails.
    if !path.parent().is_some_and(Path::is_dir) {
        return;
    }
    let partial = remove_if_present(&path.with_extension("part"));
    let file = remove_if_present(&path);
    let metadata = remove_if_present(&root.join(format!("{}.json.part", item.id)));
    if partial.is_ok() && file.is_ok() && metadata.is_ok() {
        let _ = fs::remove_file(root.join(format!("{}.pending", item.id)));
    }
}
pub fn clean_pending(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "pending") {
            let Ok(bytes) = fs::read(&path) else {
                continue;
            };
            let Ok(item) = serde_json::from_slice::<Download>(&bytes) else {
                continue;
            };
            if path.file_stem().is_none_or(|stem| stem != item.id.as_str())
                || valid_id(&item.id).is_err()
            {
                continue;
            }
            if root.join(format!("{}.json", item.id)).exists() {
                let _ = fs::remove_file(path); // Fully committed: preserve the media.
            } else {
                rollback(root, &item);
            }
        }
    }
}
pub fn list(root: &Path) -> Result<Vec<Download>, String> {
    let mut result = Vec::new();
    for entry in
        fs::read_dir(root).map_err(|_| "Impossible de lire la bibliothèque des téléchargements")?
    {
        let entry = entry.map_err(|_| "Impossible de lire la bibliothèque des téléchargements")?;
        if entry.path().extension().is_none_or(|ext| ext != "json") {
            continue;
        }
        let Ok(bytes) = fs::read(entry.path()) else {
            continue;
        };
        let Ok(mut item) = serde_json::from_slice::<Download>(&bytes) else {
            continue;
        };
        if entry
            .path()
            .file_stem()
            .is_none_or(|stem| stem != item.id.as_str())
        {
            continue;
        }
        let Ok(path) = stored_path(root, &item) else {
            continue;
        };
        item.available = path.is_file();
        item.file_path = Some(path);
        result.push(item);
    }
    result.sort_by_key(|item| std::cmp::Reverse(item.downloaded_at));
    Ok(result)
}
pub fn remove(root: &Path, id: &str) -> Result<(), String> {
    let id = valid_id(id)?;
    let path = path_for(root, &id)?;
    // When a volume is disconnected, remove the library entry, not any other file.
    remove_if_present(&path).map_err(write_error)?;
    remove_if_present(&root.join(format!("{id}.json"))).map_err(write_error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!("horus-storage-{}", Uuid::new_v4()));
            fs::create_dir(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn finish(root: &Path) -> Download {
        let mut item = begin(
            root,
            &Uuid::new_v4().to_string(),
            serde_json::json!({"title":"Test"}),
        )
        .unwrap();
        fs::write(
            item.file_path.as_ref().unwrap().with_extension("part"),
            b"synthetic media",
        )
        .unwrap();
        item.size_bytes = 15;
        commit(root, &item).unwrap();
        item
    }
    #[test]
    fn old_library_remains_readable_missing_files_can_be_removed() {
        let root = Temp::new();
        let id = Uuid::new_v4().to_string();
        fs::write(root.0.join(format!("{id}.json")), serde_json::to_vec(&serde_json::json!({"id":id,"metadata":{"title":"Old"},"sizeBytes":99,"downloadedAt":1})).unwrap()).unwrap();
        fs::write(root.0.join(format!("{id}.mp4")), b"old").unwrap();
        assert!(list(&root.0).unwrap()[0].available);
        fs::remove_file(path_for(&root.0, &id).unwrap()).unwrap();
        assert!(!list(&root.0).unwrap()[0].available);
        remove(&root.0, &id).unwrap();
        assert!(list(&root.0).unwrap().is_empty());
    }
    #[test]
    fn changing_directory_preserves_existing_files_and_scopes_deletion() {
        let root = Temp::new();
        let external = Temp::new();
        let old = finish(&root.0);
        set_directory(&root.0, Some(external.0.to_string_lossy().into())).unwrap();
        let new = finish(&root.0);
        assert!(path_for(&root.0, &old.id).unwrap().starts_with(&root.0));
        assert!(path_for(&root.0, &new.id)
            .unwrap()
            .starts_with(fs::canonicalize(&external.0).unwrap()));
        fs::write(external.0.join("personal.mp4"), b"keep").unwrap();
        remove(&root.0, &new.id).unwrap();
        assert!(path_for(&root.0, &old.id).unwrap().is_file());
        assert!(external.0.join("personal.mp4").is_file());
        set_directory(&root.0, None).unwrap();
        assert_eq!(
            directory(&root.0).unwrap(),
            fs::canonicalize(&root.0).unwrap()
        );
    }
    #[test]
    fn interrupted_external_download_cleanup_never_removes_committed_or_unrelated_files() {
        let root = Temp::new();
        let external = Temp::new();
        set_directory(&root.0, Some(external.0.to_string_lossy().into())).unwrap();
        let completed = finish(&root.0);
        let item = begin(
            &root.0,
            &Uuid::new_v4().to_string(),
            serde_json::Value::Null,
        )
        .unwrap();
        fs::write(external.0.join("personal.part"), b"keep").unwrap();
        clean_pending(&root.0);
        assert!(!item.file_path.unwrap().with_extension("part").exists());
        assert!(completed.file_path.unwrap().is_file());
        assert!(external.0.join("personal.part").is_file());
        assert!(!root.0.join(format!("{}.pending", item.id)).exists());
    }
    #[test]
    fn invalid_directory_and_duplicate_id_do_not_overwrite_anything() {
        let root = Temp::new();
        assert!(set_directory(&root.0, Some("relative".into())).is_err());
        let item = finish(&root.0);
        assert!(begin(&root.0, &item.id, serde_json::Value::Null).is_err());
        assert_eq!(
            fs::read(item.file_path.unwrap()).unwrap(),
            b"synthetic media"
        );
        assert!(path_for(&root.0, "../../personal").is_err());
    }
    #[test]
    fn metadata_write_failure_can_rollback_media_and_queue_can_retry() {
        let root = Temp::new();
        let external = Temp::new();
        set_directory(&root.0, Some(external.0.to_string_lossy().into())).unwrap();
        let item = begin(
            &root.0,
            &Uuid::new_v4().to_string(),
            serde_json::Value::Null,
        )
        .unwrap();
        // A directory where the temporary index should be forces a real write failure.
        let obstruction = root.0.join(format!("{}.json.part", item.id));
        fs::create_dir(&obstruction).unwrap();
        // Error kinds (and therefore user-facing messages) differ across platforms.
        assert!(commit(&root.0, &item).is_err());
        let file = item.file_path.as_ref().unwrap();
        let pending = root.0.join(format!("{}.pending", item.id));
        let index = root.0.join(format!("{}.json", item.id));
        assert!(file.is_file()); // The MP4 rename succeeded before the index write failed.
        assert!(!index.exists());
        rollback(&root.0, &item);
        assert!(!file.exists());
        assert!(!file.with_extension("part").exists());
        assert!(obstruction.is_dir());
        assert!(pending.is_file()); // Keep the journal until cleanup can finish.
        fs::remove_dir(&obstruction).unwrap();
        clean_pending(&root.0);
        assert!(!obstruction.exists());
        assert!(!pending.exists());
        assert!(!index.exists());
        assert!(list(&root.0).unwrap().is_empty());
        finish(&root.0);
        assert_eq!(list(&root.0).unwrap().len(), 1);
    }
    #[test]
    fn missing_destination_never_silently_falls_back_to_the_default() {
        let root = Temp::new();
        let external = Temp::new();
        set_directory(&root.0, Some(external.0.to_string_lossy().into())).unwrap();
        fs::remove_dir(&external.0).unwrap();
        let id = Uuid::new_v4().to_string();
        assert!(begin(&root.0, &id, serde_json::Value::Null)
            .unwrap_err()
            .contains("introuvable"));
        assert!(!root.0.join(format!("{id}.mp4")).exists());
        assert!(!root.0.join(format!("{id}.pending")).exists());
    }
    #[test]
    fn a_crash_after_commit_preserves_the_completed_file() {
        let root = Temp::new();
        let item = finish(&root.0);
        fs::write(
            root.0.join(format!("{}.pending", item.id)),
            serde_json::to_vec(&item).unwrap(),
        )
        .unwrap();
        clean_pending(&root.0);
        assert!(path_for(&root.0, &item.id).unwrap().is_file());
        assert!(!root.0.join(format!("{}.pending", item.id)).exists());
    }
}
