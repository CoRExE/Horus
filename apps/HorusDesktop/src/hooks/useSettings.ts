import { useState, type FormEvent } from "react";
import { useLibrary } from "../store/library";

export function useSettings(
  setError: (error: string) => void,
  setNotice: (notice: string) => void,
) {
  const library = useLibrary.getState();
  const [apiInput, setApiInput] = useState(library.apiUrl);
  const saveApiUrl = (event: FormEvent) => {
    event.preventDefault();
    try {
      const url = new URL(apiInput);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      library.setApiUrl(url.href.replace(/\/$/, ""));
      setNotice("Adresse du catalogue enregistrée.");
      setError("");
    } catch {
      setError("Saisissez une URL HTTP ou HTTPS valide.");
    }
  };
  return { apiInput, setApiInput, saveApiUrl };
}
