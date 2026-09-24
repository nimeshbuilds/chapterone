## Connect one provider first

Open **Settings**. The provider status rows show whether a command is installed and whether its account appears connected. A command being found is not the same as being signed in.

Connection status checks inspect CLI login status or API metadata; they do not send a generation prompt. Model validation is a separate, explicit action and may use quota as explained below.

| Provider | How ChapterOne connects | What you supply |
| --- | --- | --- |
| Claude Code | The installed Claude Code CLI | A working CLI installation and provider sign-in |
| Codex | The installed Codex CLI | A working CLI installation and provider sign-in |
| Gemini | Google's REST API | A Gemini API key with access to the chosen model |
| Grok | The installed Grok CLI | A working CLI installation and provider sign-in |

CLI means *command-line interface*: a provider's own application that ChapterOne runs on your computer. You use its normal login flow; ChapterOne does not store your Claude, Codex, or Grok account password.

## Set up Claude Code, Codex, or Grok

1. In Settings, find the provider's status row.
2. If it is missing, choose **Install**. The in-app install flow requires Node.js with npm available on your computer. If you prefer the provider's own installation method, follow its official guide below, then return to ChapterOne.
3. Choose **Sign in** and complete the provider's terminal or browser flow.
4. Return to ChapterOne and choose **Re-check CLIs** or **Check sign-in**.
5. Add the provider to the engine chain and choose a model.

Official setup guides: [Claude Code](https://code.claude.com/docs/en/overview), [Codex CLI](https://developers.openai.com/codex/cli), and [Grok CLI](https://docs.x.ai/build/cli/reference).

The Settings command fields are for an executable name or path, such as `codex`, not a whole shell command. If ChapterOne cannot find a CLI you installed elsewhere, use its full executable path and choose **Save commands**. Restart the app after changing your system PATH.

> **Use subscription:** this option removes known API-key environment variables before launching a CLI. It cannot override every CLI account or configuration setting. Confirm your active account and billing mode with the provider itself.

## Set up Gemini

1. Create or locate a key in [Google AI Studio](https://aistudio.google.com/apikey).
2. In Settings, find **Gemini API key · illustrations & Gemini engine**.
3. Paste the key, choose **Save**, and then **Test key**.
4. Add Gemini to your writing chain and select a text model.

ChapterOne uses the **Gemini API**, even if you also have the separate Gemini CLI installed. The same saved key can power Gemini writing and optional Nano Banana illustrations. Those are API requests with Google's own billing and limits. Testing the key reads provider information; it does not generate a paid sample image.

## Choose a model

Each provider in the engine chain has its own model picker. The catalog shows reviewed choices and compatibility notes. Availability depends on your account, provider region, installed CLI version, and the provider's current rollout.

- **Default** follows the provider default or the app's API default. It does not promise a particular model or the newest release.
- **Fast** applies the catalog's speed-oriented preset across providers in the chain.
- **Pro** applies its quality-oriented preset. It may use more quota or have different billing.
- **Custom model…** preserves an exact ID you enter, including models released after the app's catalog was reviewed.

See the [model reference](model-reference.md) for the actual IDs, required versions, retirement notices, and official sources. Saved custom or older model choices are not silently replaced when the app's catalog changes.

## Check a custom model

Select **Custom model…**, enter the provider's exact model ID, and choose **Check model** if you want to validate it. Do not infer a CLI's accepted model name from an API name; the two products may expose different models.

For Claude Code and Codex, a model check sends a short test prompt and can use quota or API billing. For Gemini and Grok, it checks provider model metadata without generating text. A successful check does not guarantee the model will remain available or that a long book will finish within your limit.

## Set up automatic fallback

The engine chain runs from top to bottom. Put your preferred provider first, then add only providers you have connected and are comfortable using for the same manuscript.

Transient failures receive bounded retries. If an eligible error persists, the chain can move to the next provider and continue the current job. The progress screen reports switches. This can help a book continue after a quota or network problem, but it cannot guarantee that every provider will succeed.

**Fallback is also a data and billing choice.** Book context can be sent to another company, and that company's limits or API charges apply. For sensitive work, keep the chain limited to providers you have deliberately approved for the manuscript.

## When a provider changes

Update the provider CLI using its official instructions, check your account's model access, and review the [model reference](model-reference.md). If an old pin retires, choose an available model yourself. The app preserves saved pins to avoid changing a project's provider behavior unexpectedly.

If setup still fails, use [provider troubleshooting](troubleshooting.md#my-provider-is-installed-but-not-connected).
