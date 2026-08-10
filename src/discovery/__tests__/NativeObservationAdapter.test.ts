import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAndroidXml,
  parseIosXml,
  parseNativeObservation,
} from '../NativeObservationAdapter.js';

// ── fixture XML ───────────────────────────────────────────────────────────────

const ANDROID_LOGIN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout"
        package="com.example" content-desc="" checkable="false" checked="false"
        clickable="false" enabled="true" focusable="false" focused="false"
        scrollable="false" long-clickable="false" password="false"
        selected="false" bounds="[0,0][1080,2160]">
    <node index="0" text="Email" resource-id="com.example:id/email_input"
          class="android.widget.EditText" package="com.example"
          content-desc="Email address field" checkable="false" checked="false"
          clickable="true" enabled="true" focusable="true" focused="true"
          scrollable="false" long-clickable="true" password="false"
          selected="false" bounds="[60,400][1020,520]"/>
    <node index="0" text="Login" resource-id="com.example:id/btn_login"
          class="android.widget.Button" package="com.example"
          content-desc="Login" checkable="false" checked="false"
          clickable="true" enabled="true" focusable="true" focused="false"
          scrollable="false" long-clickable="false" password="false"
          selected="false" bounds="[100,700][980,820]"/>
    <node index="0" text="" resource-id="com.example:id/loading_spinner"
          class="android.widget.ProgressBar" package="com.example"
          content-desc="" checkable="false" checked="false"
          clickable="false" enabled="false" focusable="false" focused="false"
          scrollable="false" long-clickable="false" password="false"
          selected="false" bounds="[480,900][600,1020]"/>
  </node>
</hierarchy>`;

const ANDROID_CHECKBOX_XML = `<hierarchy>
  <node class="android.widget.CheckBox" text="Remember me"
        resource-id="com.example:id/chk_remember" content-desc=""
        checkable="true" checked="true" clickable="true"
        enabled="true" focusable="true" focused="false" selected="false"
        bounds="[40,600][260,680]"/>
</hierarchy>`;

const IOS_LOGIN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="MyApp"
      label="MyApp" enabled="true" visible="true" x="0" y="0"
      width="390" height="844">
    <XCUIElementTypeTextField type="XCUIElementTypeTextField" name="email_field"
        label="Email address" value="user@example.com" enabled="true" visible="true"
        x="20" y="200" width="350" height="44"/>
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="login_btn"
        label="Login" value="" enabled="true" visible="true"
        x="155" y="400" width="80" height="44"/>
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="cancel_btn"
        label="Cancel" value="" enabled="false" visible="true"
        x="0" y="800" width="80" height="44"/>
  </XCUIElementTypeApplication>
</AppiumAUT>`;

// ── Android tests ─────────────────────────────────────────────────────────────

describe('parseAndroidXml — basic extraction', () => {
  it('returns an element per node', () => {
    const els = parseAndroidXml(ANDROID_LOGIN_XML);
    // root FrameLayout + 3 children
    assert.equal(els.length, 4);
  });

  it('extracts resourceId (last path component)', () => {
    const els = parseAndroidXml(ANDROID_LOGIN_XML);
    const email = els.find((e) => e.resourceId === 'email_input');
    assert.ok(email, 'email_input resourceId must be found');
  });

  it('extracts accessibilityLabel from content-desc', () => {
    const els = parseAndroidXml(ANDROID_LOGIN_XML);
    const email = els.find((e) => e.resourceId === 'email_input');
    assert.equal(email?.accessibilityLabel, 'Email address field');
  });

  it('extracts text', () => {
    const els = parseAndroidXml(ANDROID_LOGIN_XML);
    const btn = els.find((e) => e.resourceId === 'btn_login');
    assert.equal(btn?.text, 'Login');
  });

  it('extracts role (class)', () => {
    const els = parseAndroidXml(ANDROID_LOGIN_XML);
    const btn = els.find((e) => e.resourceId === 'btn_login');
    assert.equal(btn?.role, 'android.widget.Button');
  });
});

describe('parseAndroidXml — bounds', () => {
  it('parses bounds correctly', () => {
    const els = parseAndroidXml(ANDROID_LOGIN_XML);
    const btn = els.find((e) => e.resourceId === 'btn_login');
    assert.deepEqual(btn?.bounds, { x: 100, y: 700, width: 880, height: 120 });
  });

  it('root element has full-screen bounds', () => {
    const els = parseAndroidXml(ANDROID_LOGIN_XML);
    const root = els[0]!;
    assert.deepEqual(root.bounds, { x: 0, y: 0, width: 1080, height: 2160 });
  });
});

describe('parseAndroidXml — state flags', () => {
  it('enabled=true for clickable button', () => {
    const els = parseAndroidXml(ANDROID_LOGIN_XML);
    const btn = els.find((e) => e.resourceId === 'btn_login');
    assert.equal(btn?.enabled, true);
  });

  it('enabled=false for disabled progress bar', () => {
    const els = parseAndroidXml(ANDROID_LOGIN_XML);
    const spinner = els.find((e) => e.resourceId === 'loading_spinner');
    assert.equal(spinner?.enabled, false);
  });

  it('interactive=true for clickable button', () => {
    const els = parseAndroidXml(ANDROID_LOGIN_XML);
    const btn = els.find((e) => e.resourceId === 'btn_login');
    assert.equal(btn?.interactive, true);
  });

  it('focused=true for focused input', () => {
    const els = parseAndroidXml(ANDROID_LOGIN_XML);
    const email = els.find((e) => e.resourceId === 'email_input');
    assert.equal(email?.focused, true);
  });

  it('focused=false for non-focused button', () => {
    const els = parseAndroidXml(ANDROID_LOGIN_XML);
    const btn = els.find((e) => e.resourceId === 'btn_login');
    assert.equal(btn?.focused, false);
  });

  it('checked=true for checked checkbox', () => {
    const els = parseAndroidXml(ANDROID_CHECKBOX_XML);
    const cb = els.find((e) => e.resourceId === 'chk_remember');
    assert.equal(cb?.checked, true);
  });
});

describe('parseAndroidXml — hierarchy', () => {
  it('root has children', () => {
    const els = parseAndroidXml(ANDROID_LOGIN_XML);
    const root = els[0]!;
    assert.equal(root.childIds?.length, 3);
  });

  it('children reference correct parent', () => {
    const els = parseAndroidXml(ANDROID_LOGIN_XML);
    const root = els[0]!;
    const btn = els.find((e) => e.resourceId === 'btn_login')!;
    assert.equal(btn.parentId, root.id);
  });

  it('root has no parentId', () => {
    const els = parseAndroidXml(ANDROID_LOGIN_XML);
    assert.equal(els[0]?.parentId, undefined);
  });
});

// ── iOS tests ─────────────────────────────────────────────────────────────────

describe('parseIosXml — basic extraction', () => {
  it('returns elements (skips AppiumAUT wrapper)', () => {
    const els = parseIosXml(IOS_LOGIN_XML);
    assert.ok(els.length >= 3, `expected ≥3, got ${els.length}`);
  });

  it('extracts label as accessibilityLabel', () => {
    const els = parseIosXml(IOS_LOGIN_XML);
    const tf = els.find((e) => e.testId === 'email_field');
    assert.equal(tf?.accessibilityLabel, 'Email address');
  });

  it('extracts name as testId', () => {
    const els = parseIosXml(IOS_LOGIN_XML);
    const btn = els.find((e) => e.testId === 'login_btn');
    assert.ok(btn);
  });

  it('extracts value as text', () => {
    const els = parseIosXml(IOS_LOGIN_XML);
    const tf = els.find((e) => e.testId === 'email_field');
    assert.equal(tf?.text, 'user@example.com');
  });

  it('marks disabled element as enabled=false', () => {
    const els = parseIosXml(IOS_LOGIN_XML);
    const cancel = els.find((e) => e.testId === 'cancel_btn');
    assert.equal(cancel?.enabled, false);
  });
});

describe('parseIosXml — bounds', () => {
  it('extracts x/y/width/height', () => {
    const els = parseIosXml(IOS_LOGIN_XML);
    const btn = els.find((e) => e.testId === 'login_btn');
    assert.deepEqual(btn?.bounds, { x: 155, y: 400, width: 80, height: 44 });
  });
});

// ── parseNativeObservation wrapper ────────────────────────────────────────────

describe('parseNativeObservation', () => {
  it('wraps android elements in a UiObservation', () => {
    const obs = parseNativeObservation(ANDROID_LOGIN_XML, 'android', {
      appPackage: 'com.example',
    });
    assert.equal(obs.platform, 'android');
    assert.equal(obs.source, 'native');
    assert.equal(obs.context.appPackage, 'com.example');
    assert.ok(obs.elements.length > 0);
    assert.ok(obs.id.startsWith('obs-'));
    assert.ok(obs.timestamp.length > 0);
  });

  it('wraps ios elements in a UiObservation', () => {
    const obs = parseNativeObservation(IOS_LOGIN_XML, 'ios');
    assert.equal(obs.platform, 'ios');
    assert.ok(obs.elements.length > 0);
  });
});
