import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent, Button } from '@pazarsync/web';

export const Open = () => (
  <TooltipProvider>
    <Tooltip open>
      <TooltipTrigger asChild>
        <Button variant="outline" size="sm">
          Net Kâr nedir?
        </Button>
      </TooltipTrigger>
      <TooltipContent>Komisyon, kargo, KDV ve stopaj düşülmüş tutar</TooltipContent>
    </Tooltip>
  </TooltipProvider>
);
