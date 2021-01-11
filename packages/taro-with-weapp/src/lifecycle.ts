interface LifecycleMap {
  [key: string]: string[]
}

export enum TaroLifeCycles {
  WillMount = 'componentWillMount',
  DidMount = 'componentDidMount',
  DidShow = 'componentDidShow',
  DidHide = 'componentDidHide',
  WillUnmount = 'componentWillUnmount'
}

export const lifecycleMap: LifecycleMap = {
  [TaroLifeCycles.WillMount]: ['created', 'onLanuch'], // onLoad会在别的地方调用
  [TaroLifeCycles.DidMount]: ['onReady', 'ready', 'attached'],
  [TaroLifeCycles.DidShow]: ['onShow', 'show'],
  [TaroLifeCycles.DidHide]: ['onHide', 'hide'],
  [TaroLifeCycles.WillUnmount]: ['detached', 'onUnload']
}

export const lifecycles = new Set<string>()

for (const key in lifecycleMap) {
  const lifecycle = lifecycleMap[key]
  lifecycle.forEach(l => lifecycles.add(l))
}
