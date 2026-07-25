import {
  Component,
  ChangeDetectionStrategy,
  AfterViewInit,
  OnDestroy,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../../environments/environment';

/** DOM id of the element the widget renders into. */
const WXO_ROOT_ID = 'wxo-root';
/** DOM id given to the injected loader script so it can be de-duplicated/cleaned up. */
const WXO_SCRIPT_ID = 'wxo-loader-script';

/** Minimal shape of the global exposed by the WatsonX loader script. */
interface WxoLoader {
  init?: () => void;
}

/**
 * WxAssistantComponent
 *
 * Embeds the WatsonX Orchestrate chat agent in a full-height page frame.
 * The wxoLoader script is injected lazily (only in the browser, and only when
 * the assistant is enabled for the current build target) the first time this
 * component mounts. Both the script tag and the `wxOConfiguration` global are
 * removed on destroy so re-navigating the SPA never leaves duplicate scripts or
 * stale config behind.
 *
 * Connection details live in `environment.watsonxAssistant` rather than being
 * hard-coded here, so each build target (dev/staging/prod) can point at its own
 * orchestration/agent and tests can run with the widget disabled.
 */
@Component({
  selector: 'app-wx-assistant',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col h-full min-h-0" data-testid="assistant-page">
      <div
        class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0"
      >
        <h1 class="text-lg font-semibold text-gray-900 dark:text-gray-100">AI Assistant</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Powered by WatsonX Orchestrate
        </p>
      </div>
      @if (enabled) {
        <div
          id="wxo-root"
          data-testid="assistant-widget-root"
          class="flex-1 min-h-0 overflow-hidden"
        ></div>
      } @else {
        <div class="flex-1 flex items-center justify-center p-6" data-testid="assistant-disabled">
          <p class="text-sm text-gray-500 dark:text-gray-400 text-center">
            The AI Assistant is not available in this environment.
          </p>
        </div>
      }
    </div>
  `,
})
export class WxAssistantComponent implements AfterViewInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly config = environment.watsonxAssistant;

  /** Whether the assistant is enabled for the current build target. */
  protected readonly enabled = this.config.enabled;

  private loaderScript: HTMLScriptElement | null = null;

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId) || !this.enabled) return;
    this.mountWidget();
  }

  ngOnDestroy(): void {
    if (this.loaderScript) {
      this.loaderScript.remove();
      this.loaderScript = null;
    }
    // Drop the global config so a later mount starts from a clean slate.
    const win = window as unknown as Record<string, unknown>;
    delete win['wxOConfiguration'];
  }

  private mountWidget(): void {
    // Guard against a second loader if one is already present (e.g. fast
    // re-navigation before a prior teardown has settled).
    if (document.getElementById(WXO_SCRIPT_ID)) return;

    const { hostURL, orchestrationID, crn, deploymentPlatform, agentId, agentEnvironmentId } =
      this.config;
    const win = window as unknown as Record<string, unknown>;

    win['wxOConfiguration'] = {
      orchestrationID,
      hostURL,
      rootElementID: WXO_ROOT_ID,
      deploymentPlatform,
      crn,
      chatOptions: {
        agentId,
        agentEnvironmentId,
      },
    };

    const script = document.createElement('script');
    script.id = WXO_SCRIPT_ID;
    script.src = `${hostURL}/wxochat/wxoLoader.js?embed=true`;
    script.addEventListener('load', () => {
      const loader = win['wxoLoader'] as WxoLoader | undefined;
      loader?.init?.();
    });
    document.head.appendChild(script);
    this.loaderScript = script;
  }
}
