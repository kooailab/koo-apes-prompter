# Text generation request

`generate-text.request.json` is an HTTP request body, not a saved ComfyUI workflow.
Replace `YOUR_INSTALLED_MODEL` with your model's exact name. With ComfyUI and your
chosen provider running, POST the JSON to `/koo/prompter11/v1/generate-text` on
your ComfyUI server. The response contains `ok` and `prompt`.

To use the node visually, add **KoO Apes Prompter 1.1**, choose the same provider
and model, enter the idea and click Generate. Connect its STRING output to your
text encoder. For vision, connect an IMAGE, enable image support for a compatible
model and queue the workflow.

No API key or personal model path is included. Supply custom API credentials
through the existing session credential control or environment variables.
