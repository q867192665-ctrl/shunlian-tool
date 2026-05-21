# 页面数据刷新优化方法

## 概述

为了避免页面在定时刷新数据时出现闪烁或重新渲染整个页面的问题，我们采用了区分初始加载和后续刷新的优化方法。

## 核心思路

1. **区分加载状态**：初始加载显示loading状态，后续刷新保持当前数据显示
2. **使用 useCallback**：优化函数引用，避免不必要的重渲染
3. **条件渲染**：仅在初始加载且无数据时显示loading状态

## 实现代码

### 1. 状态定义

```typescript
const [initialLoading, setInitialLoading] = useState(true);
const [data, setData] = useState<DataType[]>([]);
const [error, setError] = useState<string | null>(null);
```

### 2. 数据获取函数

```typescript
const fetchData = useCallback(async (isInitial: boolean = false) => {
  if (!routerIp) return;
  
  try {
    if (isInitial) setInitialLoading(true);
    setError(null);
    
    const resp = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip: routerIp }),
    });
    const result = await resp.json();
    
    if (result.status === 'success') {
      setData(result.data);
    } else if (result.status === 'error') {
      if (isInitial) setError(result.message || '加载失败');
    }
  } catch (err) {
    console.error('Failed to fetch data:', err);
    if (isInitial) setError(err instanceof Error ? err.message : '加载失败');
  } finally {
    if (isInitial) setInitialLoading(false);
  }
}, [routerIp]);
```

### 3. useEffect 调用

```typescript
useEffect(() => {
  fetchData(true);  // 初始加载
  const interval = setInterval(() => fetchData(false), 5000);  // 定时刷新
  return () => clearInterval(interval);
}, [fetchData]);
```

### 4. 渲染逻辑

```typescript
const renderContent = () => {
  // 仅在初始加载且无数据时显示loading
  if (initialLoading && data.length === 0) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.spinner} />
        <p>加载中...</p>
      </div>
    );
  }

  // 仅在初始加载出错且无数据时显示错误
  if (error && data.length === 0) {
    return (
      <div className={styles.emptyState}>
        <WarningOutlined className={styles.errorIcon} />
        <p className={styles.errorText}>{error}</p>
        <button className={styles.retryButton} onClick={() => fetchData(true)}>
          重试
        </button>
      </div>
    );
  }

  // 正常渲染数据
  return (
    <div className={styles.content}>
      {/* 数据展示 */}
    </div>
  );
};
```

### 5. 刷新按钮

```typescript
<button onClick={() => fetchData(false)}>
  刷新
</button>
```

## 关键点说明

| 参数/状态 | 说明 |
|-----------|------|
| `isInitial` | 区分是否为初始加载，`true` 表示初始加载，`false` 表示刷新 |
| `initialLoading` | 仅在初始加载时为 `true`，刷新时保持 `false` |
| `fetchData(true)` | 首次加载或重试时调用 |
| `fetchData(false)` | 定时刷新或手动刷新时调用 |

## 优势

1. **无闪烁**：刷新时不会出现loading状态，用户体验更流畅
2. **数据保持**：刷新过程中保持当前数据显示
3. **性能优化**：使用 `useCallback` 避免不必要的函数重建
4. **错误处理**：刷新出错时不会清空已有数据

## 适用页面

- WirelessPage
- FirewallPage
- NetworkPage（已采用此模式）

## 扩展：多Tab页面

对于包含多个Tab的页面，需要根据当前Tab调用对应的fetch函数：

```typescript
const fetchData = useCallback((isInitial: boolean = false) => {
  switch (activeTab) {
    case 'tab1':
      fetchTab1Data(isInitial);
      break;
    case 'tab2':
      fetchTab2Data(isInitial);
      break;
  }
}, [activeTab, fetchTab1Data, fetchTab2Data]);
```
