import { ChartFrame, Currency } from '@pazarsync/web';

export const Default = () => (
  <div className="max-w-modal w-full">
    <ChartFrame
      title="Günlük Ciro"
      value={<Currency value={42380} />}
      delta={{ percent: 6.4, goodDirection: 'up' }}
    >
      <div className="gap-3xs flex h-28 items-end">
        {[40, 65, 30, 80, 55, 90, 70].map((h, i) => (
          // runtime-dynamic: demo bar heights
          <div key={i} className="bg-info/70 flex-1 rounded-sm" style={{ height: `${h}%` }} />
        ))}
      </div>
    </ChartFrame>
  </div>
);
