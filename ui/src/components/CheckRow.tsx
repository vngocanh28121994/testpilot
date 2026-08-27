/**
 * Ô tick với nhãn nằm trong <label>.
 *
 * Bọc thay vì `htmlFor`: tên khả truy cập là nguyên câu nhãn, đúng thứ e2e đang
 * gọi qua `getByRole('checkbox', { name: … })`, và không cần bịa id cho từng ô.
 */
export function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2.5 text-sm">
      <input
        type="checkbox"
        className="accent-primary mt-0.5 size-4 shrink-0"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
