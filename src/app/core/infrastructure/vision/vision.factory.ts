import { Provider } from '@angular/core';
import { VISION_RECOGNIZER } from '@core/application/ports/vision-recognizer.port';
import { ClaudeVisionAdapter } from '@core/infrastructure/vision/claude-vision.adapter';
import { MockVisionAdapter } from '@core/infrastructure/vision/mock-vision.adapter';
import { environment } from '../../../../environments/environment';

/**
 * Binds VISION_RECOGNIZER to a concrete adapter for this build target.
 *
 * Mirrors REPOSITORY_PROVIDERS: the choice is made once, here, from a feature
 * flag, so no component or facade has to know which recognizer it got. With
 * `features.aiVision` off (the default in every environment) the clerk runs on
 * the offline mock, which is why the test suite needs no network stubbing.
 *
 * Both adapters are registered as concrete classes so `useExisting` resolves
 * them through DI and each still gets its own injected dependencies.
 */
export const VISION_PROVIDERS: Provider[] = [
  MockVisionAdapter,
  ClaudeVisionAdapter,
  {
    provide: VISION_RECOGNIZER,
    useExisting: environment.features.aiVision ? ClaudeVisionAdapter : MockVisionAdapter,
  },
];
