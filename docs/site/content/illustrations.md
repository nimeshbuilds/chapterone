## Choose the right image mode

| Mode | Best fit | Provider usage |
| --- | --- | --- |
| Off | Text-first drafting, lower-cost experiments, books that do not need art | No illustration requests |
| AI art from your writing engine | Stylized scene illustrations and diagrams made from HTML/CSS/SVG | Uses writing-provider quota or API billing |
| Nano Banana | Generated raster images and character-reference guidance | Uses your Gemini image API key and Google's billing |

Choose the mode in the new-book form. There is no need to enable illustrations to make a complete text manuscript. Writing-engine art is not free merely because it does not use a separate image API.

## Set up Nano Banana

1. Open **Settings → Gemini API key · illustrations & Gemini engine**.
2. Add a Gemini API key, select an image model, and save.
3. Use **Test key** to check provider access without generating a sample image.
4. Return to your new-book brief and choose Nano Banana.
5. Review the image estimate and confirm before starting.

The displayed estimate is based on planned image count and standard image-output pricing for the selected model. Input and thinking tokens can cost extra; the final image count, requested output, retries, and provider pricing can change the total. It is not a spending cap. Check the [model reference](model-reference.md) and your provider billing controls.

## Keep characters consistent

Write clear visual descriptions in the character fields. In Kids Books, you may attach reference photos for Nano Banana. These photos are stored with the local book and sent to Google when used for image generation.

Only share reference images you have permission to use. A reference can guide appearance; it does not ensure an exact likeness, consistent costume, accurate anatomy, or matching details in every scene. Review each picture yourself.

## What happens when an illustration fails

Chapter text is checkpointed before optional art. If an image request fails or cannot be rendered safely, the book may still contain its saved prose and other illustrations. The progress screen reports the issue.

Resuming an interrupted book continues from saved chapters; it does not automatically regenerate every missing picture. If an illustration is essential, inspect the result before exporting and keep a separate editing workflow for any art you need to replace manually outside the app.

## Review exported artwork

EPUB, HTML, and PDF can include the book's supported artwork. **Word exports currently contain formatted text without illustrations.** Image placement and sizing vary by format and reader, so check the actual file.

Generated art is not guaranteed to be original, copyright-free, accurate, or suitable for every audience. Review both the image and the service's terms before sharing or publishing it. Legacy books may also carry stock-image credits; retain relevant attribution in your publication workflow.
