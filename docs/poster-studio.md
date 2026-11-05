# Temporary poster studio

Open `http://localhost:5173/#presentation` in a new tab after starting the website.
The standalone page reuses the committed IFC-derived XKT model twice: a solid
building and an extracted cyan X-ray counterpart. It does not start another
simulator or change monitoring state. Eighteen gently pulsing markers use the
existing IFC sensor centres. Their animation is decorative, not a data-quality,
reporting or alarm indicator.

The initial extraction takes approximately 4.5 seconds. Drag to rotate and use
the wheel to zoom. Pause freezes the transition, Replay restarts it, and Fit
restores the composition. X-ray only removes the solid copy. Poster frame stops
at the fully extracted composition and makes the markers bright. Clean screenshot
also hides the text and toolbar; press Escape to restore controls. Export PNG
captures a 2400 × 1350 transparent model image without the HTML labels or background.

WebGL 2 is required. Reduced-motion preference opens at the final composition
with animation stopped. Loading two copies uses more graphics memory than the
normal viewer; close the overview tab if necessary. All model instances, render
callbacks and resize observers are destroyed when the page unmounts.

This page is intentionally outside the permanent sidebar. To remove it later,
remove the Presentation import and hash route from `src/main.tsx`, then delete
`src/pages/Presentation.tsx`, `src/pages/presentation.css` and
`src/viewer/presentationViewer.js`.
