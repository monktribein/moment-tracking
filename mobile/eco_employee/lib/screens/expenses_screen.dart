import 'dart:io';

import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

const expenseCategories = ['Travel (field visit)', 'Fuel', 'Meals / local conveyance', 'Stay', 'Mobile / internet', 'Other'];

/// Expense history.
class ExpensesScreen extends ConsumerStatefulWidget {
  const ExpensesScreen({super.key});

  @override
  ConsumerState<ExpensesScreen> createState() => _ExpensesScreenState();
}

class _ExpensesScreenState extends ConsumerState<ExpensesScreen> {
  final key = GlobalKey<LoaderState<Paged>>();

  @override
  Widget build(BuildContext context) {
    final api = ref.read(apiClientProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Expenses')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: EcoColors.orange,
        foregroundColor: Colors.white,
        onPressed: () async {
          await context.push('/expenses/new');
          await key.currentState?.reload();
        },
        icon: const Icon(Icons.add),
        label: const Text('New expense claim'),
      ),
      body: Loader<Paged>(
        key: key,
        load: () => api.page('/v1/expenses', query: {'limit': 50, 'sort': 'expenseDate'}),
        isEmpty: (p) => p.items.isEmpty,
        empty: const EmptyView(text: 'No expense claims yet', icon: Icons.receipt_long_outlined),
        builder: (context, p, reload) => ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 90), children: [
          for (final x in p.items)
            EcoCard(
              child: Row(children: [
                const CircleAvatar(backgroundColor: Color(0xFFF1EBFF), child: Icon(Icons.receipt_long, color: EcoColors.violet)),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${x['category']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    Text('${inDate(x['expenseDate'])}${(x['description'] ?? '').toString().isEmpty ? '' : ' · ${x['description']}'}', style: const TextStyle(color: EcoColors.muted), maxLines: 2),
                    if (x['rejectionReason'] != null) Text('Reason: ${x['rejectionReason']}', style: const TextStyle(color: EcoColors.red, fontSize: 12)),
                  ]),
                ),
                Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                  Text(inr(x['amount']), style: const TextStyle(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 4),
                  StatusChip('${x['status']}'),
                ]),
              ]),
            ),
        ]),
      ),
    );
  }
}

/// New expense claim with an optional receipt photo (required above the company limit).
class NewExpenseScreen extends ConsumerStatefulWidget {
  const NewExpenseScreen({super.key});

  @override
  ConsumerState<NewExpenseScreen> createState() => _NewExpenseScreenState();
}

class _NewExpenseScreenState extends ConsumerState<NewExpenseScreen> {
  final _form = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _description = TextEditingController();
  final _submitKey = SubmitKey();
  String _category = expenseCategories.first;
  DateTime _date = DateTime.now();
  List<File> _receipt = [];
  String? _receiptKey;
  bool _busy = false;

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    final api = ref.read(apiClientProvider);
    final ok = await runSubmit(context, () async {
      if (_receipt.isNotEmpty && _receiptKey == null) _receiptKey = await api.uploadPrivate(_receipt.first, 'receipt');
      await api.post('/v1/expenses', headers: {'Idempotency-Key': _submitKey.value}, body: {
        'expenseDate': apiDay(_date),
        'category': _category,
        'amount': double.parse(_amount.text.trim()),
        if (_description.text.trim().isNotEmpty) 'description': _description.text.trim(),
        if (_receiptKey != null) 'receiptKey': _receiptKey,
      });
    }, success: 'Expense submitted for approval');
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      _submitKey.reset();
      context.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('New expense claim')),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          DropdownButtonFormField<String>(
            value: _category,
            decoration: const InputDecoration(labelText: 'Category'),
            items: [for (final c in expenseCategories) DropdownMenuItem(value: c, child: Text(c))],
            onChanged: (v) => setState(() => _category = v ?? _category),
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _amount,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'Amount (₹)', prefixText: '₹ '),
            validator: (v) {
              final n = double.tryParse((v ?? '').trim());
              if (n == null || n <= 0) return 'Enter the amount';
              if (!RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(v!.trim())) return 'Up to 2 decimals';
              return null;
            },
          ),
          const SizedBox(height: 14),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.calendar_today, color: EcoColors.blue),
            title: const Text('Date'),
            subtitle: Text(inDate(apiDay(_date))),
            trailing: const Icon(Icons.edit_calendar),
            onTap: () async {
              final d = await showDatePicker(context: context, initialDate: _date, firstDate: DateTime.now().subtract(const Duration(days: 90)), lastDate: DateTime.now());
              if (d != null) setState(() => _date = d);
            },
          ),
          TextFormField(controller: _description, maxLength: 500, maxLines: 2, decoration: const InputDecoration(labelText: 'Description')),
          const SizedBox(height: 8),
          const Text('Receipt / bill photo', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          PhotoStrip(files: _receipt, max: 1, label: 'Receipt', onChanged: (f) => setState(() {
                _receipt = f;
                _receiptKey = null;
              })),
          const Text('A receipt is required above the company limit (₹500 by default).', style: TextStyle(fontSize: 12, color: EcoColors.muted)),
          const SizedBox(height: 20),
          ElevatedButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Sending…' : 'Submit claim')),
        ]),
      ),
    );
  }
}
