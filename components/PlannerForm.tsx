"use client";
import React, { useState } from "react";

const EXPERIENCE_OPTIONS = [
  "Live Session",
  "Coaching/Mentoring",
  "eLearning",
  "Software Simulation",
  "Practical Application Activities",
] as const;

type ExperienceType = typeof EXPERIENCE_OPTIONS[number];

export type PlannerFormValues = {
  orgName: string;
  overview: string; // renamed from Engagement Notes
  audience: string;
  requestedModuleCount: number | null; // null => AI decides
  experienceTypes: ExperienceType[];
  files: File[];
};

type Props = {
  onLaunch?: (values: PlannerFormValues) => void; // wired in a later step
};

export default function PlannerForm({ onLaunch }: Props) {
  const [orgName, setOrgName] = useState("");
  const [overview, setOverview] = useState("");
  const [audience, setAudience] = useState("");
  const [requestedModuleCount, setRequestedModuleCount] = useState<string>("");
  const [experienceTypes, setExperienceTypes] = useState<ExperienceType[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);

  function toggleExperience(option: ExperienceType) {
    setExperienceTypes((prev) =>
      prev.includes(option) ? prev.filter((x) => x !== option) : [...prev, option]
    );
  }

  function handleFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    handleFiles(e.dataTransfer.files);
  }

  function removeFile(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const count =
      requestedModuleCount.trim() === ""
        ? null
        : Math.max(1, parseInt(requestedModuleCount, 10) || 0);

    const payload: PlannerFormValues = {
      orgName,
      overview,
      audience,
      requestedModuleCount: count,
      experienceTypes,
      files,
    };

    // Temp verification. Wired to API in a later step.
    console.log("PlannerForm payload:", payload);
    onLaunch?.(payload);
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16, maxWidth: 900 }}>
      <div>
        <label htmlFor="org" style={{ display: "block", fontWeight: 600 }}>Organization Name</label>
        <input id="org" type="text" value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          placeholder="Acme Corp" style={{ width: "100%", padding: 8 }} />
      </div>

      <div>
        <label htmlFor="overview" style={{ display: "block", fontWeight: 600 }}>Overview</label>
        <textarea id="overview" value={overview}
          onChange={(e) => setOverview(e.target.value)}
          placeholder="Project summary, goals, constraints"
          rows={5} style={{ width: "100%", padding: 8 }} />
      </div>

      <div>
        <label htmlFor="modules" style={{ display: "block", fontWeight: 600 }}>
          Number of Modules (leave blank for AI)
        </label>
        <input id="modules" type="number" min={1} inputMode="numeric"
          value={requestedModuleCount}
          onChange={(e) => setRequestedModuleCount(e.target.value)}
          placeholder="" style={{ width: 240, padding: 8 }} />
      </div>

      <div>
        <label style={{ display: "block", fontWeight: 600 }}>Learning Experience Types</label>
        <div style={{ display: "grid", gap: 8 }}>
          {EXPERIENCE_OPTIONS.map((opt) => (
            <label key={opt} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={experienceTypes.includes(opt)}
                onChange={() => toggleExperience(opt)}
              />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="audience" style={{ display: "block", fontWeight: 600 }}>Audience</label>
        <input id="audience" type="text" value={audience}
          onChange={(e) => setAudience(e.target.value)}
          placeholder="Who will be trained" style={{ width: "100%", padding: 8 }} />
      </div>

      <div>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>
          Upload presentations, documents, PDFs
        </label>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          style={{
            border: "2px dashed #999",
            padding: 24,
            textAlign: "center",
            background: dragActive ? "#f5f5f5" : "transparent",
          }}
        >
          Drag files here
          <div style={{ margin: 12 }}>or</div>
          <label style={{ display: "inline-block", padding: "8px 12px", border: "1px solid #ccc", cursor: "pointer" }}>
            Choose files
            <input
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.ppt,.pptx,.txt"
              onChange={(e) => handleFiles(e.target.files)}
              style={{ display: "none" }}
            />
          </label>
        </div>

        {files.length > 0 && (
          <ul style={{ marginTop: 12, paddingLeft: 16 }}>
            {files.map((f, i) => (
              <li key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>{f.name}</span>
                <button type="button" onClick={() => removeFile(i)} style={{ cursor: "pointer" }}>
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <button type="submit" style={{ padding: "10px 16px", fontWeight: 600 }}>
          Launch AI Assistant
        </button>
      </div>
    </form>
  );
}
