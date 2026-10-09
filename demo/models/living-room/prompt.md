# Make a 3D model of your room from photos

This is the prompt we used to turn the four photos in [`photos/`](photos/) into [`living-room.glb`](living-room.glb), the room in the card's demo. Paste it into an AI coding agent that can run commands on your computer, such as Claude Code, fill in the four blanks, and it builds a model of **your** room for the card. Two phone photos are enough; more make it more accurate.

## What you need

- **Photos of the room**: 2 to 6 from different corners, so every wall and every piece of furniture shows in at least one, and each photo shares a few things with another. Take them from about chest height, with the whole room in frame from floor to ceiling; the phone's wide lens (0.5×) is fine. Don't move anything between photos.
- **One real measurement**: anything with a size you know or can measure, like a door (most interior doors are about 2.03 m tall), the length of the sofa or the height of the ceiling. It sets the scale; the agent checks everything else against it.
- **Where the sensor is**: say where it sits in one of the photos, for example *"at the top of the desk wall, in the left corner of photo 1"*.
- **Tools**: the agent uses Python (numpy, scipy, Pillow) and Node.js with three.js and Playwright to render, and installs what's missing.

Everything stays on your computer. A model textured with photos of your home is private: don't commit it to a public repository, and read the note on `/local/` in the README before you copy it to Home Assistant.

## The prompt

Replace the four `{…}` blanks, then paste:

```text
Build a 3D model of my room for the mmWave 3D Card (Home Assistant), from my photos.

Photos: {PATHS TO THE PHOTOS, e.g. ~/Downloads/room/1.heic … 4.heic}
Known size: {e.g. "the door is 2.03 m tall" or "the room is 4.1 m wide"}
Sensor: {where the sensor is, e.g. "the small black box at the top of the wall above the desk, in photo 1"}
Output: {e.g. ~/Downloads/room-model/}

Work in steps and show me the result of each one as an image (photo next to the model rendered from the same
camera), saved to the output folder with a progress.md that has one line per iteration. Keep everything on my
computer: don't upload the photos or the model anywhere.

1. Cameras. Convert the photos to JPEG. Read the focal length from EXIF (35 mm equivalent → pixels, on the
   diagonal) and take the principal point at the centre. Estimate each camera's pitch and roll from the
   vertical vanishing point (door frames, wall corners, window mullions).
2. Correspondences. Make zoomed crops with a pixel grid and mark points with known 3D meaning: room corners
   at the floor and the ceiling, door and window frames, corners of large furniture, rug corners. Prefer
   points seen in two or more photos: they tie the cameras together.
3. Joint fit. Solve one least-squares problem (scipy.optimize.least_squares) for the room's size, the
   positions and sizes of the openings and the furniture, every camera's pose and a shared focal length.
   Anchor the scale with the known size. Report the RMS error in pixels and the sizes that came out (door
   width, sofa length, rug, TV…) as sanity checks against standard sizes. Iterate, adding points where the
   residuals are large, until the RMS is below about 6 px. A point with a residual of hundreds of pixels is
   usually marked against the wrong corner: check it on an overlay and relabel it. If one photo disagrees
   with the others, down-weight it rather than bending the room. Don't assume the room is a perfect
   rectangle if the photos say otherwise.
4. Geometry. Use one frame: metres, y up, floor at y = 0, x across the room, z along it. Build the floor, the
   ceiling and the walls (with their door and window openings) as single-sided planes facing into the
   room, so the card can show it as a doll's house from outside. Model the furniture with boxes or simple
   parametric shapes that match the real pieces; if you recognise a product, use its published dimensions.
   Render the model's edges over each photo from its fitted camera and fix what doesn't line up.
5. Textures. Bake a texture for every surface by projecting the photos back onto it (about 300 px per metre),
   with occlusion (a depth map per photo, with a margin at furniture edges so they don't bleed onto what is
   behind) and, for each texel, the photo that sees it best: weight by (cos of the viewing angle ÷ distance)^8,
   which is best view with a short feather. Averaging views makes ghosts. Even out the exposure between photos. Mask what shouldn't
   be in the model: open doors or hatches (model them closed), people, clutter. Fill texels no photo sees
   with a push-pull inpaint or the surface's median colour. If a thin or complex piece of furniture gets
   smeared, give it flat colours sampled from the photos instead. Photo textures carry their own light, so
   make those materials unlit (KHR_materials_unlit). Don't upscale beyond about twice the photos' resolution.
6. Sensor. Find the sensor in the photo I named and intersect that pixel's ray with the wall or ceiling it
   is on. Add a small black box there named "mmwave_sensor" with userData.facing set to the direction it
   faces into the room.
7. Export. Write one GLB with three.js GLTFExporter: JPEG textures, under 8 MB. Load it back with GLTFLoader
   and check the mesh count, the size of the room and the sensor's position.
8. Report. Give me: the room's size, the final RMS, the sensor's position [x, height, z] and its heading in
   degrees (0 = the model's +z, 90 = +x, 180 = -z), what the photos don't cover, and the card's config:

   model:
     url: /local/<file>.glb
     sensor: { position: [x, height, z], heading: <deg> }
     style: textured        # or futuristic
```

## If your photos are AI renders

Images generated by AI (for example, a render of how you'd furnish the room) don't describe one consistent room:
furniture sizes and positions drift from one image to the next. The demo's living room was made from four of them.
Add this to the prompt:

```text
The photos are AI-generated, so the views won't agree exactly. Give each photo its own focal length (bounded,
about 18–35 mm equivalent), use a robust loss (soft_l1, f_scale ~5 px), add soft priors for typical furniture
sizes (3-seat sofa ~2.3 × 0.95 m, coffee table ~1.3 × 0.7 × 0.4 m, interior door 2.03 × 0.82 m), and weight each
piece by the views that see it best. Report the median and per-photo error instead of chasing one low RMS. For
textures, sample each planar face through its own homography per photo, fitted to that face's marked points,
so each view only has to agree with itself.
```

## Then, in Home Assistant

Copy the `.glb` to `/config/www/`, ideally with a name nobody would guess, and add the `model:` block the agent gave you to the card. See [A 3D model of your room](../../../README.md#a-3d-model-of-your-room) for the options.
