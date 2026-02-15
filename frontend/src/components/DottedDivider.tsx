export default function DottedDivider() {
  return (
    <div className="w-full max-w-5xl mx-auto py-16 flex items-center gap-4">
      <div className="w-2 h-2 rounded-full bg-gold" />
      <div className="flex-1 border-t border-dotted border-gold/30" />
      <div className="w-1.5 h-1.5 rounded-full bg-gold/40" />
    </div>
  )
}
