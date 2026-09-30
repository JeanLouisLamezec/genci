const MessageBridge = require('./taskflow-message-bridge');

function createHarness(options = {}) {
    const listeners = {};
    const parentWindow = { postMessage: jest.fn() };
    const childWindow = { postMessage: jest.fn() };
    const shellWindow = {
        parent: parentWindow,
        location: { href: 'https://widgets.example.test/taskflow/' },
        addEventListener: jest.fn((type, listener) => { listeners[type] = listener; }),
        removeEventListener: jest.fn((type, listener) => {
            if (listeners[type] === listener) delete listeners[type];
        })
    };
    const onBlocked = jest.fn();
    const bridge = MessageBridge.createMessageBridge({
        window: shellWindow,
        parentWindow,
        parentOrigin: 'https://grist.example.test',
        childUrl: 'https://widgets.example.test/taskflow/gantt/',
        getChildWindow: () => childWindow,
        onBlocked,
        ...options
    });
    return { bridge, shellWindow, parentWindow, childWindow, listeners, onBlocked };
}

function rpcCall() {
    return {
        mtype: MessageBridge.MESSAGE_TYPES.RPC_CALL,
        reqId: 12,
        iface: 'GristDocAPI',
        meth: 'fetchTable',
        args: ['Tasks']
    };
}

describe('TaskFlowMessageBridge', () => {
    test('accepte les cinq enveloppes grain-rpc attendues', () => {
        expect(MessageBridge.isValidGristMessage(rpcCall())).toBe(true);
        expect(MessageBridge.isValidGristMessage({ mtype: 2, reqId: 12, data: { ok: true } })).toBe(true);
        expect(MessageBridge.isValidGristMessage({ mtype: 3, reqId: 12, mesg: 'Erreur', code: 'DENIED' })).toBe(true);
        expect(MessageBridge.isValidGristMessage({ mtype: 4, mdest: 'grist', data: ['event'] })).toBe(true);
        expect(MessageBridge.isValidGristMessage({ mtype: 5 })).toBe(true);
    });

    test('refuse les messages sans enveloppe RPC valide', () => {
        expect(MessageBridge.isValidGristMessage(null)).toBe(false);
        expect(MessageBridge.isValidGristMessage('Ready')).toBe(false);
        expect(MessageBridge.isValidGristMessage({ mtype: 0 })).toBe(false);
        expect(MessageBridge.isValidGristMessage({ mtype: 1, iface: 'GristDocAPI', meth: 'fetchTable' })).toBe(false);
        expect(MessageBridge.isValidGristMessage({ mtype: 2, reqId: '12' })).toBe(false);
        expect(MessageBridge.isValidGristMessage({ mtype: 3, reqId: 12, mesg: 42 })).toBe(false);
        expect(MessageBridge.isValidGristMessage({ mtype: 4 })).toBe(false);
    });

    test('determine l origine par l ancetre direct puis par le referrer', () => {
        const parent = {};
        const embeddedWindow = {
            parent,
            location: { href: 'https://widgets.test/', ancestorOrigins: ['https://grist.test'] }
        };
        expect(MessageBridge.resolveParentOrigin({
            window: embeddedWindow,
            location: embeddedWindow.location,
            document: { referrer: 'https://fallback.test/doc' }
        })).toBe('https://grist.test');

        embeddedWindow.location.ancestorOrigins = [];
        expect(MessageBridge.resolveParentOrigin({
            window: embeddedWindow,
            location: embeddedWindow.location,
            document: { referrer: 'https://fallback.test/doc' }
        })).toBe('https://fallback.test');
    });

    test('relaie enfant vers parent avec l origine cible explicite', () => {
        const harness = createHarness();
        const stopImmediatePropagation = jest.fn();
        const accepted = harness.bridge.handleMessage({
            source: harness.childWindow,
            origin: 'https://widgets.example.test',
            data: rpcCall(),
            stopImmediatePropagation
        });

        expect(accepted).toBe(true);
        expect(stopImmediatePropagation).toHaveBeenCalledTimes(1);
        expect(harness.parentWindow.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ mtype: 1 }),
            'https://grist.example.test'
        );
    });

    test('relaie parent vers le seul widget actif avec son origine explicite', () => {
        const harness = createHarness();
        const message = { mtype: 2, reqId: 12, data: ['Tasks'] };
        const accepted = harness.bridge.handleMessage({
            source: harness.parentWindow,
            origin: 'https://grist.example.test',
            data: message
        });

        expect(accepted).toBe(true);
        expect(harness.childWindow.postMessage).toHaveBeenCalledWith(
            message,
            'https://widgets.example.test'
        );
    });

    test('bloque une origine ou une source inattendue et un schema invalide', () => {
        const harness = createHarness();
        const attacker = { postMessage: jest.fn() };

        expect(harness.bridge.handleMessage({
            source: harness.childWindow,
            origin: 'https://evil.example.test',
            data: rpcCall(),
            stopImmediatePropagation: jest.fn()
        })).toBe(false);
        expect(harness.bridge.handleMessage({
            source: harness.parentWindow,
            origin: 'https://grist.example.test',
            data: { mtype: 1, iface: 'GristDocAPI', meth: 'fetchTable' }
        })).toBe(false);
        expect(harness.bridge.handleMessage({
            source: attacker,
            origin: 'https://grist.example.test',
            data: rpcCall()
        })).toBe(false);

        expect(harness.parentWindow.postMessage).not.toHaveBeenCalled();
        expect(harness.childWindow.postMessage).not.toHaveBeenCalled();
        expect(harness.onBlocked).toHaveBeenCalledTimes(2);
    });

    test('actualise l origine enfant lors d un changement d onglet', () => {
        const harness = createHarness();
        expect(harness.bridge.setChildUrl('https://whiteboard.example.test/')).toBe('https://whiteboard.example.test');

        expect(harness.bridge.handleMessage({
            source: harness.childWindow,
            origin: 'https://widgets.example.test',
            data: rpcCall(),
            stopImmediatePropagation: jest.fn()
        })).toBe(false);
        expect(harness.bridge.handleMessage({
            source: harness.childWindow,
            origin: 'https://whiteboard.example.test',
            data: rpcCall(),
            stopImmediatePropagation: jest.fn()
        })).toBe(true);
    });

    test('installe et retire un seul listener message', () => {
        const harness = createHarness();
        harness.bridge.start();
        harness.bridge.start();
        expect(harness.shellWindow.addEventListener).toHaveBeenCalledTimes(1);
        expect(harness.listeners.message).toBe(harness.bridge.handleMessage);

        harness.bridge.stop();
        expect(harness.shellWindow.removeEventListener).toHaveBeenCalledWith(
            'message',
            harness.bridge.handleMessage
        );
    });
});
