import { redirect } from 'next/navigation';

// /ground with no stock: the list of every ground, Stock rankings.
export default function GroundIndex() {
  redirect('/attendance');
}
