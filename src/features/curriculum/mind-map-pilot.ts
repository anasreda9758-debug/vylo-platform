export type MindMapPilotNode = {
  label: string;
  children?: MindMapPilotNode[];
};

const CVS_EXTERNAL_FEATURES: MindMapPilotNode = {
  label: "External features of the heart",
  children: [
    {
      label: "Position and orientation",
      children: [
        { label: "Middle mediastinum behind the sternum" },
        { label: "Long axis directed downward, forward, and left" },
        { label: "Enclosed by the pericardium" },
      ],
    },
    {
      label: "Surfaces",
      children: [
        { label: "Sternocostal surface: atrial and ventricular portions" },
        { label: "Diaphragmatic surface: mainly ventricular" },
        { label: "Left surface: mainly left ventricle" },
        { label: "Right surface: right atrium" },
      ],
    },
    {
      label: "Borders",
      children: [
        { label: "Upper border: both atria" },
        { label: "Lower border: mainly right ventricle" },
        { label: "Right border: right atrium" },
        { label: "Left border: mainly left ventricle" },
      ],
    },
    {
      label: "Grooves",
      children: [
        { label: "Coronary groove separates atria from ventricles" },
        { label: "Anterior interventricular groove lies between ventricles" },
        { label: "Posterior interventricular groove lies on the diaphragmatic surface" },
      ],
    },
  ],
};

export function getMindMapPilot(slug: string): MindMapPilotNode | null {
  return slug === "cvs-202-anatomy-external-features-of-the-heart"
    ? CVS_EXTERNAL_FEATURES
    : null;
}
