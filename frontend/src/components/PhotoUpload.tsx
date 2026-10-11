import { useRef, useState } from "react";
import { api, ApiError, uploadFile, type CaptureInfo } from "../lib/api";
import { useI18n } from "../lib/i18n";

const MAX_SIDE = 1600;

/** Downscale on the phone so uploads are fast and stay under the vision model's image size limit.
 *  Redrawing on a canvas strips EXIF, so GPS/time are read from the original file first (see readExif). */
async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read photo"))), "image/jpeg", 0.85),
  );
}

async function readExif(file: File): Promise<CaptureInfo> {
  try {
    const { parse } = await import("exifr");
    const data = (await parse(file, { gps: true, pick: ["DateTimeOriginal", "latitude", "longitude"] })) as
      | { latitude?: number; longitude?: number; DateTimeOriginal?: Date }
      | undefined;
    if (!data) return {};
    const out: CaptureInfo = {};
    if (typeof data.latitude === "number" && typeof data.longitude === "number") {
      out.exifLat = data.latitude;
      out.exifLon = data.longitude;
    }
    // exifr returns local camera time as a Date; send it without a zone so the server treats it as IST.
    if (data.DateTimeOriginal instanceof Date) {
      const d = data.DateTimeOriginal;
      const pad = (n: number) => String(n).padStart(2, "0");
      out.exifTakenAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
    return out;
  } catch {
    return {};
  }
}

/** Browser location, or null if denied/unavailable. Never rejects. */
function getLocation(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  });
}

interface Props {
  planId: string;
  purpose: "installation" | "check";
  busyLabel?: string;
  disabled?: boolean;
  onUploaded: (key: string, capture: CaptureInfo) => Promise<void>;
}

export default function PhotoUpload({ planId, purpose, busyLabel, disabled, onUploaded }: Props) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const location = useRef<Promise<GeolocationPosition | null> | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "locating" | "uploading" | "processing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [noLocation, setNoLocation] = useState(false);

  function open() {
    // Ask for location in parallel with choosing the photo.
    location.current = getLocation();
    input.current?.click();
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setStage("locating");
      const [position, exif] = await Promise.all([location.current ?? getLocation(), readExif(file)]);
      setNoLocation(!position);
      const capture: CaptureInfo = { ...exif, capturedAt: new Date().toISOString() };
      if (position) {
        capture.captureLat = position.coords.latitude;
        capture.captureLon = position.coords.longitude;
        capture.captureAccuracyM = Math.round(position.coords.accuracy);
        capture.capturedAt = new Date(position.timestamp).toISOString();
      }
      setStage("uploading");
      const jpeg = await toJpeg(file);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(jpeg);
      });
      const { uploadUrl, key, contentType } = await api.uploadUrl(planId, purpose, "image/jpeg");
      await uploadFile(uploadUrl, jpeg, contentType);
      setStage("processing");
      await onUploaded(key, capture);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("retakeHint"));
    } finally {
      setStage("idle");
      location.current = null;
      if (input.current) input.current.value = "";
    }
  }

  const busy = stage !== "idle";
  const label =
    stage === "locating" ? t("gettingLocation") : stage === "uploading" ? t("uploading") : stage === "processing" ? (busyLabel ?? t("uploading")) : `${t("takePhoto")}`;
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 text-sm text-ink-soft">
        {t("standNext")}
      </p>
      {preview && <img src={preview} alt="" className="max-h-72 w-full rounded-2xl object-cover" />}
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0])}
        aria-label={t("takePhoto")}
        tabIndex={-1}
      />
      <button type="button" data-photo-button className="btn-primary w-full text-lg" disabled={busy || disabled} onClick={open}>
        {label}
      </button>
      {noLocation && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-amber-900" role="status">
          {t("locationWhy")}
        </p>
      )}
      {error && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-amber-900" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
