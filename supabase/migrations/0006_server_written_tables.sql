-- Customers read these tables; only the server writes them.
--
-- The first schema let a signed-in customer write any row of their own in
-- every table. For records the server creates, that is a hole: a customer
-- could insert their own "report" or "subscription" row straight through the
-- database API and unlock the letter builder without a monitoring
-- subscription, or alter the record of a letter after it was mailed.
--
-- The server uses the service role, which is not subject to these policies.
-- Tables customers do write stay as they were: profiles, item_flags,
-- identity_documents, and chat_messages (own journey lines only).

drop policy "own monitoring" on public.monitoring_subscriptions;
create policy "own monitoring read" on public.monitoring_subscriptions
  for select using (auth.uid() = user_id);

drop policy "own pulls" on public.report_pulls;
create policy "own pulls read" on public.report_pulls
  for select using (auth.uid() = user_id);

drop policy "own items" on public.report_items;
create policy "own items read" on public.report_items
  for select using (auth.uid() = user_id);

drop policy "own rounds" on public.attack_rounds;
create policy "own rounds read" on public.attack_rounds
  for select using (auth.uid() = user_id);

drop policy "own letters" on public.letters;
create policy "own letters read" on public.letters
  for select using (auth.uid() = user_id);

drop policy "own letter items" on public.letter_items;
create policy "own letter items read" on public.letter_items
  for select using (exists (select 1 from public.letters l where l.id = letter_id and l.user_id = auth.uid()));

drop policy "own events" on public.events;
create policy "own events read" on public.events
  for select using (auth.uid() = user_id);

-- An acknowledgment is a record: it can be made and read, not edited or removed.
drop policy "own aba" on public.aba_acknowledgments;
create policy "own aba read" on public.aba_acknowledgments
  for select using (auth.uid() = user_id);
create policy "own aba create" on public.aba_acknowledgments
  for insert with check (auth.uid() = user_id);
