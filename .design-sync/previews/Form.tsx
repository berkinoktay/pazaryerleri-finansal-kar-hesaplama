import { useForm } from 'react-hook-form';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  Input,
} from '@pazarsync/web';

export const StoreSettings = () => {
  const form = useForm({
    defaultValues: { storeName: 'Trendyol — Ana Mağaza', commission: '23,64' },
  });
  return (
    <Form {...form}>
      <form className="gap-md max-w-form flex w-full flex-col">
        <FormField
          control={form.control}
          name="storeName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Mağaza adı</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>Panelde ve raporlarda görünecek isim.</FormDescription>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="commission"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Varsayılan komisyon oranı (%)</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
};
