const getOwnProps = Object.getOwnPropertySymbols ?
  obj => [...Object.getOwnPropertyNames(obj), ...Object.getOwnPropertySymbols(obj)] :
  obj => [...Object.getOwnPropertyNames(obj)];

const makeFreshListeners = () => ({
  preget: [], postget: [], 
  setter: new Set(), listeners: new Set(),
});

const Observe = obj => {
  const props = getOwnProps(obj);
  const defineProp = Object.defineProperty.bind(Object, obj);
  const getPropDefs = Object.getOwnPropertyDescriptor.bind(Object, obj);

  const propListeners = {};
  const defaultListeners = makeFreshListeners();

  const evalGetterListeners = (type, prop, hasGet) => {
    defaultListeners[type].forEach(l => l(prop, hasGet));
    propListeners[prop][type].forEach(l => l(prop, hasGet));
  };
  const evalSetterListeners = (() => {
    let processing = false;
    const batchListeners = new Set();
  
    return prop => {
      propListeners[prop].setter.forEach(l => batchListeners.add(l));

      if (!processing && batchListeners.size) {
        processing = true;
        setImmediate(() => {
          batchListeners.forEach(l => l());
          batchListeners.clear();
          processing = false;
        });
      }
    }
  })();

  const activeDepCollectors = [];
  defaultListeners.preget.push(
    (prop, hasGet) => {
      activeDepCollectors.forEach(({ dependencies, handlers }) => {
        if (!hasGet && !dependencies.has(prop)) {
          dependencies.add(prop);
          handlers.forEach(handler =>
            propListeners[prop].setter.add(handler));
        }
      });
    });

  const getterDependencies = {};
  const makeGetterListeners = prop => {
    return [
      () => {
        let dependencies = getterDependencies[prop];
        if (!dependencies) 
          dependencies = getterDependencies[prop] = new Set();

        activeDepCollectors.push(
          { dependencies, handlers: propListeners[prop].listeners });
      },
      () => activeDepCollectors.pop()
    ];
  };

  props.forEach(prop => {
    const { value, get, writable, ...defs } = getPropDefs(prop);
    const listeners = propListeners[prop] = makeFreshListeners();

    if (get) {
      const [pre, post] = makeGetterListeners(prop);
      listeners.preget.push(pre);
      listeners.postget.push(post);

      defineProp(prop, {
        ...defs,
        configurable: false,
        get: function () {
          evalGetterListeners('preget', prop, true);
          const value = get.call(this);
          evalGetterListeners('postget', prop, true);
          return value;
        }
      });
      return;
    }

    if (defs.set || typeof obj[prop] === 'function') {
      return;
    }

    defineProp(`__value__${prop}`, {
      writable: true,
      enumerable: false,
      configurable: false,
      value: obj[prop]
    });

    defineProp(prop, {
      ...defs,
      configurable: false,
      set: function (value) {
        this[`__value__${prop}`] = value;
        evalSetterListeners(prop);
      },
      get: function () {
        evalGetterListeners('preget', prop, false);
        return this[`__value__${prop}`];
      }
    });
  });

  const handlersMap = new Map();
  const registerHandler = (props, handler) => {
    if (!handlersMap.has(handler)) {
      handlersMap.set(handler, new Map());
    }

    const handlerMap = handlersMap.get(handler);
    if (!handlerMap.get(props)) {
      handlerMap.set(props, () => {
        handler(props.reduce((a, c) =>
          ({ ...a, [c]: obj[c] }), {}));
      });
    }

    const currentValue = {};
    const listener = handlerMap.get(props);
    props.forEach(prop => {
      propListeners[prop].listeners.add(listener);
      currentValue[prop] = obj[prop];
      if (!getterDependencies[prop]) {
        propListeners[prop].setter.add(listener);
      }
    });

    handler(currentValue);
  };

  const unregisterHandler = (props, handler) => {
    const handlerMap = handlersMap.get(handler)
    const listener = handlerMap.get(props);

    handlerMap.delete(props);
    if (!handlerMap.size) handlersMap.delete(handler);

    props.forEach(prop => {
      propListeners[prop].listeners.delete(listener);
      const dependencies = getterDependencies[prop];
      if (dependencies) {
        dependencies.forEach(p => propListeners[p].setter.delete(listener));
      } else {
        propListeners[prop].setter.delete(listener);
      }
    });
  };

  const watcherMap = new Map();
  const registerWatcher = (fn, handler) => {
    if (!watcherMap.has(handler)) {
      watcherMap.set(handler, new Map());
    }

    const handlerMap = watcherMap.get(handler);
    if (!handlerMap.get(fn)) {
      handlerMap.set(fn, [new Set()]);
    }

    const wrappedFn = () => {
      const [dependencies, wrappedHandler] = handlerMap.get(fn);
      activeDepCollectors.push({ dependencies, handlers: [wrappedHandler] });

      const response = fn();
      activeDepCollectors.pop();
      return response;
    };

    const wrappedHandler = () => handler(wrappedFn());
    handlerMap.get(fn).push(wrappedHandler);
    wrappedHandler();
  };

  const unregisterWatcher = (fn, handler) => {
    const handlerMap = watcherMap.get(handler)
    const [dependencies, wrappedHandler] = handlerMap.get(fn);

    handlerMap.delete(fn);
    if (!handlerMap.size) watcherMap.delete(handler);

    dependencies.forEach(p => propListeners[p].setter.delete(wrappedHandler));
  };

  return {
    subscribe: (props, handler) => {
      const isFunction = typeof props === 'function';
      const register = isFunction ? registerWatcher : registerHandler;
      const unregister = isFunction ? unregisterWatcher : unregisterHandler;

      !isFunction && (props = [].concat(props));
      register(props, handler);
      return () => unregister(props, handler);
    }
  }
};

const obj = { a: 1, b: 2, get c() { return this.a + (this.d > 3 ? this.b : this.a) }, d: 3 };
const observable = Observe(obj);
observable.subscribe(() => obj.a + obj.d - obj.c, console.log);
observable.subscribe(['c'], console.log);

setTimeout(() => {
  obj.d = 4;
  setTimeout(() => {
    obj.b = 5;
  }, 1000);
}, 1000);
