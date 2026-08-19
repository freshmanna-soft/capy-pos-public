import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { WxAssistantComponent } from './wx-assistant.component';

// Mutable mock of the WatsonX config so individual tests can flip `enabled`
// and assert the injected loader picks up the environment values.
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    enabled: true,
    hostURL: 'https://wxo.example.test',
    orchestrationID: 'orch-123',
    crn: 'crn:test:watsonx',
    deploymentPlatform: 'ibmcloud',
    agentId: 'agent-abc',
    agentEnvironmentId: 'agent-env-xyz',
  },
}));

vi.mock('../../../environments/environment', () => ({
  environment: { watsonxAssistant: mockConfig },
}));

const SCRIPT_ID = 'wxo-loader-script';

interface WindowWithWxo {
  wxOConfiguration?: {
    orchestrationID: string;
    hostURL: string;
    rootElementID: string;
    deploymentPlatform: string;
    crn: string;
    chatOptions: { agentId: string; agentEnvironmentId: string };
  };
}

function wxoConfig(): WindowWithWxo['wxOConfiguration'] {
  return (window as unknown as WindowWithWxo).wxOConfiguration;
}

describe('WxAssistantComponent', () => {
  let fixture: ComponentFixture<WxAssistantComponent>;

  afterEach(() => {
    fixture?.destroy();
    document.getElementById(SCRIPT_ID)?.remove();
    delete (window as unknown as WindowWithWxo).wxOConfiguration;
    mockConfig.enabled = true;
  });

  async function createComponent(platform = 'browser'): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [WxAssistantComponent],
      providers: [{ provide: PLATFORM_ID, useValue: platform }],
    }).compileComponents();

    fixture = TestBed.createComponent(WxAssistantComponent);
    fixture.detectChanges();
  }

  it('should create', async () => {
    await createComponent();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the assistant page header', async () => {
    await createComponent();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="assistant-page"]')).toBeTruthy();
    expect(el.querySelector('h1')?.textContent).toContain('AI Assistant');
  });

  it('renders the widget root when enabled', async () => {
    await createComponent();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="assistant-widget-root"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="assistant-disabled"]')).toBeNull();
  });

  it('injects the loader script using environment config in the browser', async () => {
    await createComponent();

    const script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    expect(script).toBeTruthy();
    expect(script?.src).toBe('https://wxo.example.test/wxochat/wxoLoader.js?embed=true');

    const config = wxoConfig();
    expect(config?.orchestrationID).toBe('orch-123');
    expect(config?.hostURL).toBe('https://wxo.example.test');
    expect(config?.rootElementID).toBe('wxo-root');
    expect(config?.chatOptions.agentId).toBe('agent-abc');
    expect(config?.chatOptions.agentEnvironmentId).toBe('agent-env-xyz');
  });

  it('does not inject a second loader script if one already exists', async () => {
    const existing = document.createElement('script');
    existing.id = SCRIPT_ID;
    document.head.appendChild(existing);

    await createComponent();

    expect(document.querySelectorAll(`#${SCRIPT_ID}`).length).toBe(1);
    // Guard fires before config is written.
    expect(wxoConfig()).toBeUndefined();
  });

  it('removes the loader script and global config on destroy', async () => {
    await createComponent();
    expect(document.getElementById(SCRIPT_ID)).toBeTruthy();
    expect(wxoConfig()).toBeDefined();

    fixture.destroy();

    expect(document.getElementById(SCRIPT_ID)).toBeNull();
    expect(wxoConfig()).toBeUndefined();
  });

  it('does not inject anything when running on the server platform', async () => {
    await createComponent('server');

    expect(document.getElementById(SCRIPT_ID)).toBeNull();
    expect(wxoConfig()).toBeUndefined();
  });

  it('shows a disabled notice and injects nothing when disabled', async () => {
    mockConfig.enabled = false;
    await createComponent();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="assistant-disabled"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="assistant-widget-root"]')).toBeNull();
    expect(document.getElementById(SCRIPT_ID)).toBeNull();
    expect(wxoConfig()).toBeUndefined();
  });
});
