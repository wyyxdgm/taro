import { Component, ComponentLifecycle } from '@tarojs/taro'
import { getCurrentInstance } from '@tarojs/runtime'
import { lifecycles, lifecycleMap, TaroLifeCycles } from './lifecycle'
import { bind, proxy, isEqual, safeGet, safeSet } from './utils'
import { diff } from './diff'
import { clone } from './clone'
import anime from 'animejs/lib/anime.es.js'
import _ from 'lodash'

type Observer = (newProps, oldProps, changePath: string) => void

interface ObserverProperties {
  name: string,
  observer: string | Observer
}

interface ComponentClass<P = {}, S = {}> extends ComponentLifecycle<P, S> {
  new(props: P): Component<P, S>
  externalClasses: Record<string, unknown>
  defaultProps?: Partial<P>
  _observeProps?: ObserverProperties[]
  observers?: Record<string, Function>
}

interface WxOptions {
  methods?: {
    [key: string]: Function;
  }
  properties?: Record<string, Record<string, unknown> | Function>
  props?: Record<string, unknown>
  data?: Record<string, unknown>,
  observers?: Record<string, Function>
}

function defineGetter (component: Component, key: string, getter: string) {
  Object.defineProperty(component, key, {
    enumerable: true,
    configurable: true,
    get: () => {
      if (getter === 'props') {
        return component.props
      }
      return {
        ...component.state,
        ...component.props
      }
    }
  })
}

function isFunction (o): o is Function {
  return typeof o === 'function'
}

export default function withWeapp (weappConf: WxOptions) {
  return (ConnectComponent: ComponentClass) => {
    class BaseComponent<P = {}, S = {}> extends ConnectComponent {
      private _observeProps: ObserverProperties[] = []

      // mixins 可以多次调用生命周期
      private willMounts: Function[] = []

      private didMounts: Function[] = []

      private didHides: Function[] = []

      private didShows: Function[] = []

      private willUnmounts: Function[] = []

      private animations: Record<string, any> = {}

      public observers?: Record<string, Function>

      public callMethod: Function

      public didPopsUpdate: Function[] = []

      public rootNode: Element | null = null;

      private animationKeys = {
        scale: ['scaleX', 'scaleY', 'scaleZ'],
        scale3d: ['scaleX', 'scaleY', 'scaleZ'],
        translate3d: ['translateX', 'translateY', 'translateZ']
      }

      constructor (props) {
        super(props)
        this.init(weappConf)
        defineGetter(this, 'data', 'state')
        defineGetter(this, 'properties', 'props')
      }

      private initProps (props: any) {
        for (const propKey in props) {
          if (props.hasOwnProperty(propKey)) {
            const propValue = props[propKey]
            if (!isFunction(propValue)) {
              if (propValue.observer) {
                this._observeProps.push({
                  name: propKey,
                  observer: propValue.observer
                })
              }
            }
            proxy(this, 'props', propKey)
          }
        }
      }

      private init (options: WxOptions) {
        for (const confKey in options) {
          const confValue = options[confKey]
          switch (confKey) {
            case 'externalClasses':
              break
            case 'data': {
              this.state = confValue
              const keys = Object.keys(this.state)
              let i = keys.length
              while (i--) {
                const key = keys[i]
                proxy(this, 'state', key)
              }
              break
            }
            case 'properties':
              this.initProps(confValue)
              break
            case 'methods':
              for (const key in confValue) {
                const method = confValue[key]
                this[key] = bind(method, this)
              }
              break
            case 'behaviors':
              // this.initMixins(confValue, options);
              break
            case 'lifetimes':
              for (const key in confValue) {
                const lifecycle = confValue[key]
                this.initLifeCycles(key, lifecycle)
              }
              break
            case 'pageLifetimes':
              for (const key in confValue) {
                const lifecycle = confValue[key]
                this.initLifeCycles(key, lifecycle)
              }
              break
            default:
              if (lifecycles.has(confKey)) {
                const lifecycle = options[confKey]
                this.initLifeCycles(confKey, lifecycle)
              } else if (isFunction(confValue)) {
                this[confKey] = bind(confValue, this)
              } else {
                try {
                  this[confKey] = confValue
                } catch (e) {
                  console.error(e, confKey, confValue);
                }
              }
              break
          }
        }
        // 小程序需要在created和attached之间，执行observers
        this.willMounts.push(() => {
          // console.log('didMounts triggerObservers', this.props)
          this.triggerObservers(this.props, {}, true);
        })
        // wxs中可以调用callMethod使用page方法
        this.callMethod = (method, args) => {
          this[method](args);
        }
      }

      private initLifeCycles (lifecycleName: string, lifecycle: Function) {
        for (const lifecycleKey in lifecycleMap) {
          const cycleNames = lifecycleMap[lifecycleKey]
          if (cycleNames.indexOf(lifecycleName) !== -1) {
            switch (lifecycleKey) {
              case TaroLifeCycles.DidHide:
                this.didHides.push(lifecycle)
                break
              case TaroLifeCycles.DidMount:
                this.didMounts.push(lifecycle)
                break
              case TaroLifeCycles.DidShow:
                this.didShows.push(lifecycle)
                break
              case TaroLifeCycles.WillMount:
                this.willMounts.push(lifecycle)
                break
              case TaroLifeCycles.WillUnmount:
                this.willUnmounts.push(lifecycle)
                break
              default:
                break
            }
          }
        }

        // mixins 不会覆盖已经设置的生命周期，加入到 this 是为了形如 this.created() 的调用
        if (lifecycleName === 'show') {
          lifecycleName = 'onShow';
        } if (lifecycleName === 'hide') {
          lifecycleName = 'onHide';
        }
        if (!isFunction(this[lifecycleName])) {
          try {
            this[lifecycleName] = lifecycle
          } catch (e) {
            console.error(e)
          }
        }
      }

      private safeExecute = (func?: Function, ...args: unknown[]) => {
        if (isFunction(func)) return func.apply(this, args)
      }

      private executeLifeCycles (funcs: Function[], ...args: unknown[]) {
        for (let i = 0; i < funcs.length; i++) {
          const func = funcs[i]
          this.safeExecute(func, ...args)
        }
      }

      public selectComponent = (...args: unknown[]) => {
        const page = getCurrentInstance().page
        if (page && page.selectComponent) {
          page.selectComponent(...args)
        } else {
          // tslint:disable-next-line: no-console
          console.error('page 下没有 selectComponent 方法')
        }
      }
      /**
       * 清除animate后遗留的样式属性
       * @param selector 选择器（同 SelectorQuery.select 的选择器格式）
       * @param options 需要清除的属性，不填写则全部清除
       * @param callback 清除完成后的回调函数
       */
      public clearAnimation = (selector: string, options: Function | Object, callback: Function | undefined) => {
        // tslint:disable-next-line: no-console
        if (typeof options === 'function') {
          callback = options;
          options = {};
        }
        // console.log('ani.clearAnimation', selector, 'options=', options, 'callback=', callback, 'this.animations[selector]', this.animations[selector])
        if (!this.animations || !this.animations[selector]) return;
        if (!_.isEmpty(options)) {
          let keys = Object.keys(options);
          let propSet = {};
          let savedStyle = this.animations[selector];
          for (let idx in keys) {
            let key = keys[idx];
            if (this.animationKeys[key]) {
              for (let subKeyIdx in this.animationKeys[key]) {
                let subKey = this.animationKeys[key][subKeyIdx];
                if (savedStyle[subKey] !== undefined) {
                  propSet[subKey] = savedStyle[subKey];
                }
              }
            } else {
              if (savedStyle[key] !== undefined) {
                propSet[key] = savedStyle[key]
              }
            }
          }
          // console.log('ani.set+', selector, propSet)
          anime.set(this.querySelector(selector), propSet);
          // for (let key in propSet) {
          //   delete savedStyle[key];
          // }
        } else {
          // console.log('ani.set+', selector, this.animations[selector])
          anime.set(this.querySelector(selector), this.animations[selector]);
          // delete this.animations[selector];
        }
        if (typeof callback === 'function') {
          callback();
        }
      }
      private _tranEase (ease) {
        switch (ease) {
          case 'ease-out':
            return 'easeOutCubic';
            break;
          case 'ease-in':
            return 'easeInCubic';
            break;
          case undefined:
          default:
            return 'easeInOutCubic';
            break;
        }
      }
      public getPageId = () => {
        const path = getCurrentInstance().page.path
        return path;
      }
      public querySelector = (selector: string) => {
        if (!this.rootNode) this.rootNode = document.querySelector(`[id='${this.getPageId()}']`)
        if (!this.rootNode) return null;
        return this.rootNode.querySelector(selector);
      }
      private saveAnimateKey = (targets: Element | null, selector: string, key: string | number) => {
        let value = anime.get(targets, key);
        // console.log('ani.save+', selector, key, '=', value)
        if (!this.animations[selector]) this.animations[selector] = {};
        if (this.animations[selector][key] === undefined) this.animations[selector][key] = /\-?[0-9]/.test(value) ? parseFloat(value) : value;
      }
      /**
       * animate动画
       * @param selector 选择器（同 SelectorQuery.select 的选择器格式）
       * @param keyframes 关键帧信息
       * @param duration 动画持续时长（毫秒为单位）
       * @param callback 动画完成后的回调函数
       */
      public animate = (selector: string, keyframes: Object[], duration: number, callback: Function) => {
        const page = getCurrentInstance().page
        if (page && page.animate) {
          page.animate(selector, keyframes, duration, callback)
        } else {
          console.log('page', page)
          if (document && this.querySelector) {
            // const supportedProps = ['opacity', 'zoom', 'ease', 'scale', 'scale3d', 'translate3d']
            let targets = this.querySelector(selector);
            if (!targets) return console.error(`节点不存在: ${selector}`);
            // console.log('ani.animate selector=', selector, 'keyframes=', keyframes, 'duration=', duration)
            let animeConfig = {
              targets,
            };
            const _animeConfig = {};
            keyframes.map((keyframe, idx) => {
              if (!(keyframe['offset'] >= 0 && keyframe['offset'] <= 1)) keyframe['offset'] = keyframes.length === 1 ? 1 : idx / (keyframes.length - 1);
            })
            for (let keyframeIdx in keyframes) {
              let keyframe = keyframes[keyframeIdx];
              for (let key in keyframe) {
                switch (key) {
                  case 'offset':
                    break;
                  case 'opacity':
                  case 'zoom':
                    if (!_animeConfig[key]) _animeConfig[key] = {};
                    _animeConfig[key][keyframe['offset']] = { value: keyframe[key], easing: this._tranEase(keyframe['ease']), duration: duration * keyframe['offset'] }
                  case 'scale':
                  case 'scale3d':
                    for (let index in keyframe[key]) { // [1,2,3?]
                      let _key = this.animationKeys.scale[index];
                      if (!_animeConfig[_key]) _animeConfig[_key] = {};
                      _animeConfig[_key][keyframe['offset']] = { value: keyframe[key][index], easing: this._tranEase(keyframe['ease']), duration: duration * keyframe['offset'] }
                    }
                    break;
                  case 'translate3d':
                    for (let index in keyframe[key]) { // [1,2,3?]
                      let _key = this.animationKeys.translate3d[index];
                      if (!_animeConfig[_key]) _animeConfig[_key] = {};
                      _animeConfig[_key][keyframe['offset']] = { value: keyframe[key][index], easing: this._tranEase(keyframe['ease']), duration: duration * keyframe['offset'] }
                    }
                    break;
                  case 'ease':
                    break;
                  default:
                    return console.error(`暂不支持动画:${key}，请先新增动画支持`);
                    break;
                }
              }
            }
            for (let key in _animeConfig) {
              animeConfig[key] = Object.values(_animeConfig[key])
              this.saveAnimateKey(targets, selector, key);
            }
            // console.log('ani.config', animeConfig)
            let ani = anime(animeConfig);
            ani.finished.then(() => {
              if (typeof callback === 'function') { callback(); }
            });
            return ani;
          }
          console.error('当前平台不支持animate');
          // todo animate
          if (typeof callback === 'function') { callback(); }
        }
      }

      public getRelationNodes = (...args: unknown[]) => {
        const page = getCurrentInstance().page
        if (page && page.getRelationNodes) {
          page.getRelationNodes(...args)
        } else {
          // tslint:disable-next-line: no-console
          console.error('page 下没有 getRelationNodes 方法')
        }
      }

      setData = (obj: S, callback?: () => void) => {
        let oldState
        if (this.observers && Object.keys(Object.keys(this.observers))) {
          oldState = clone(this.state)
        }
        Object.keys(obj).forEach(key => {
          safeSet(this.state, key, obj[key])
        })
        this.setState(this.state, () => {
          this.triggerObservers(this.state, oldState)
          if (callback) {
            callback.call(this)
          }
        })
      }

      private triggerObservers (current, prev, byMounted?: boolean) {
        const observers = this.observers
        if (observers == null) {
          return
        }

        if (Object.keys(observers).length === 0) {
          return
        }

        const result = diff(current, prev)
        const resultKeys = Object.keys(result)
        if (resultKeys.length === 0) {
          return
        }

        for (const observerKey in observers) {
          const keys = observerKey.split(',').map(k => k.trim())
          const args: any = []
          for (let i = 0; i < keys.length; i++) {
            const key = keys[i]
            for (let j = 0; j < resultKeys.length; j++) {
              const resultKey = resultKeys[j]
              // 暂不支持 '**'
              // current为data时，可能取不到observers中监听的props，所以需要拼接所有数据源
              if (
                resultKey === key || resultKey.startsWith(`${key}.`) || resultKey.startsWith(`${key}[`) ||
                (key.startsWith(resultKey) && key.endsWith(']'))
              ) {
                args.push(safeGet(current, key))
              }
            }
          }
          if (args.length) {
            // 首次mounted直接执行
            if (byMounted) {
              observers[observerKey].apply(this, args)
            } else {
              // 确保在properties更新之后触发
              this.didPopsUpdate.push(() => {
                observers[observerKey].apply(this, args)
              })
            }

            // setTimeout(() => {
            //   observers[observerKey].apply(this, args)
            // });
          }
        }
      }

      public triggerEvent = (eventName: string, ...args: unknown[]) => {
        const func = this.props[`on${eventName[0].slice(0, 1).toUpperCase()}${eventName.slice(1)}`]
        if (isFunction(func)) {
          func.apply(this, args.map(a => ({ detail: a })))
        }
      }

      public componentWillMount () {
        this._observeProps.forEach(({ name: key, observer }) => {
          const prop = this.props[key]
          if (typeof observer === 'string') {
            const ob = this[observer]
            if (isFunction(ob)) {
              ob.call(this, prop, prop, key)
            }
          } else if (isFunction(observer)) {
            observer.call(this, prop, prop, key)
          }
        })
        this.safeExecute(super.componentWillMount)
        this.executeLifeCycles(this.willMounts, getCurrentInstance().router || {})
      }

      public componentDidMount () {
        this.safeExecute(super.componentDidMount)
        this.executeLifeCycles(this.didMounts)
      }

      public componentWillUnmount () {
        this.safeExecute(super.componentWillUnmount)
        this.executeLifeCycles(this.willUnmounts)
      }

      public componentDidHide () {
        this.safeExecute(super.componentDidHide)
        this.executeLifeCycles(this.didHides)
      }

      public componentDidShow () {
        this.safeExecute(super.componentDidShow)
        this.executeLifeCycles(this.didShows, getCurrentInstance().router || {})
      }
      public componentDidUpdate (...args: any): void {
        // console.log('trigger:componentDidUpdate', this.didPopsUpdate);
        this.executeLifeCycles(this.didPopsUpdate, getCurrentInstance().router || {})
        this.didPopsUpdate.length = 0;
        if (isFunction(super.componentDidUpdate)) {
          return super.componentDidUpdate.apply(this, args);
        }
      }

      public componentWillReceiveProps (nextProps: P) {
        this.triggerObservers(nextProps, this.props)
        this._observeProps.forEach(({ name: key, observer }) => {
          const prop = this.props[key]
          const nextProp = nextProps[key]
          // 小程序是深比较不同之后才 trigger observer
          if (!isEqual(prop, nextProp)) {
            if (typeof observer === 'string') {
              const ob = this[observer]
              if (isFunction(ob)) {
                ob.call(this, nextProp, prop, key)
              }
            } else if (isFunction(observer)) {
              observer.call(this, nextProp, prop, key)
            }
          }
        })
        this.safeExecute(super.componentWillReceiveProps)
      }
    }

    const props = weappConf.properties

    if (props) {
      for (const propKey in props) {
        const propValue = props[propKey]
        if (propValue != null && !isFunction(propValue)) {
          if (propValue.value !== undefined) { // 如果是 null 也赋值到 defaultProps
            BaseComponent.defaultProps = {
              [propKey]: propValue.value,
              ...BaseComponent.defaultProps
            }
          }
        }
      }
    }

    const staticOptions = ['externalClasses', 'relations', 'options']

    staticOptions.forEach(option => {
      const value = weappConf[option]
      if (value != null) {
        BaseComponent[option] = value
      }
    })

    return BaseComponent
  }
}
