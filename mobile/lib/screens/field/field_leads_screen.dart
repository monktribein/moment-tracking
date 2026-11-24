import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../api/api_service.dart';
import '../../models/lead.dart';
import '../../theme/app_theme.dart';
import 'field_create_lead_screen.dart';
import 'voice_notes_section.dart';

class FieldLeadsScreen extends StatefulWidget {
  const FieldLeadsScreen({super.key});

  @override
  State<FieldLeadsScreen> createState() => _FieldLeadsScreenState();
}

class _FieldLeadsScreenState extends State<FieldLeadsScreen> {
  final TextEditingController _searchController = TextEditingController();
  List<Lead> _allLeads = [];
  bool _loading = true;

  // Date filters: 'today', 'yesterday', 'tomorrow', 'custom', 'all'
  String _dateFilter = 'today';
  DateTime? _customDate;

  // Status filters: 'all', 'pending', 'approved', 'converted', 'rejected'
  String _statusFilter = 'all';

  final List<String> _statusOptions = [
    'all',
    'pending',
    'approved',
    'converted',
    'rejected',
  ];

  @override
  void initState() {
    super.initState();
    _fetchLeads();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _fetchLeads() async {
    setState(() => _loading = true);
    try {
      final leads = await context.read<ApiService>().fieldGetLeads(
        search: _searchController.text.trim(),
      );
      if (mounted) {
        setState(() {
          _allLeads = leads;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _selectCustomDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _customDate ?? now,
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: const ColorScheme.light(
              primary: AppColors.primary,
              onPrimary: Colors.white,
              onSurface: AppColors.text,
            ),
          ),
          child: child!,
        );
      },
    );

    if (picked != null) {
      setState(() {
        _customDate = picked;
        _dateFilter = 'custom';
      });
    }
  }

  List<Lead> get _filteredLeads {
    return _allLeads.where((lead) {
      // 1. Status Filter
      if (_statusFilter != 'all' && lead.status != _statusFilter) {
        return false;
      }

      // 2. Date Filter
      if (_dateFilter == 'today') {
        if (!lead.isToday) return false;
      } else if (_dateFilter == 'yesterday') {
        if (!lead.isYesterday) return false;
      } else if (_dateFilter == 'tomorrow') {
        if (!lead.isTomorrow) return false;
      } else if (_dateFilter == 'custom') {
        if (_customDate != null && !lead.matchesDate(_customDate!)) {
          return false;
        }
      }

      // 3. Search Filter
      final q = _searchController.text.trim().toLowerCase();
      if (q.isNotEmpty) {
        final matchesName = lead.name.toLowerCase().contains(q);
        final matchesOwner = lead.contact.ownerName.toLowerCase().contains(q);
        final matchesPhone = lead.contact.phone.contains(q);
        final matchesCity = lead.location.city.toLowerCase().contains(q);
        final matchesNotes = lead.notes.toLowerCase().contains(q);
        if (!matchesName &&
            !matchesOwner &&
            !matchesPhone &&
            !matchesCity &&
            !matchesNotes) {
          return false;
        }
      }

      return true;
    }).toList();
  }

  int _countForDate(String filter) {
    if (filter == 'today') {
      return _allLeads.where((l) => l.isToday).length;
    }
    if (filter == 'yesterday') {
      return _allLeads.where((l) => l.isYesterday).length;
    }
    if (filter == 'tomorrow') {
      return _allLeads.where((l) => l.isTomorrow).length;
    }
    if (filter == 'all') {
      return _allLeads.length;
    }
    if (filter == 'custom' && _customDate != null) {
      return _allLeads.where((l) => l.matchesDate(_customDate!)).length;
    }
    return 0;
  }

  String _formatDate(DateTime dt) {
    final now = DateTime.now();
    final isToday =
        dt.year == now.year && dt.month == now.month && dt.day == now.day;
    final yest = now.subtract(const Duration(days: 1));
    final isYesterday =
        dt.year == yest.year && dt.month == yest.month && dt.day == yest.day;

    final time = DateFormat('hh:mm a').format(dt);
    if (isToday) return 'Today at $time';
    if (isYesterday) return 'Yesterday at $time';
    return DateFormat('dd MMM yyyy, hh:mm a').format(dt);
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'approved':
        return AppColors.success;
      case 'converted':
        return AppColors.info;
      case 'rejected':
        return AppColors.danger;
      default:
        return AppColors.warning;
    }
  }

  Color _statusBg(String status) {
    switch (status.toLowerCase()) {
      case 'approved':
        return AppColors.successLight;
      case 'converted':
        return AppColors.infoLight;
      case 'rejected':
        return AppColors.dangerLight;
      default:
        return AppColors.warningLight;
    }
  }

  void _showLeadDetails(Lead lead) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(ctx).size.height * 0.92,
        ),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: Colors.grey.shade300,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      lead.name,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        color: AppColors.text,
                      ),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: _statusBg(lead.status),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      lead.status.toUpperCase(),
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        color: _statusColor(lead.status),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const CircleAvatar(
                  backgroundColor: AppColors.primaryLight,
                  child: Icon(Icons.person, color: AppColors.primary),
                ),
                title: Text(
                  lead.contact.ownerName,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                subtitle: Text(
                  lead.contact.phone.isNotEmpty
                      ? lead.contact.phone
                      : 'No phone provided',
                ),
                trailing: lead.contact.phone.isNotEmpty
                    ? ElevatedButton.icon(
                        onPressed: () =>
                            launchUrl(Uri.parse('tel:${lead.contact.phone}')),
                        icon: const Icon(Icons.phone, size: 16),
                        label: const Text('Call'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.success,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          // The app theme makes buttons full width, which a
                          // ListTile's trailing slot can't hold.
                          minimumSize: const Size(0, 40),
                        ),
                      )
                    : null,
              ),
              const Divider(),
              if (lead.location.formattedAddress.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(
                        Icons.location_on,
                        size: 18,
                        color: AppColors.primary,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          lead.location.formattedAddress,
                          style: const TextStyle(
                            fontSize: 13,
                            color: AppColors.text,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              if (lead.roomInventory.totalRooms != null ||
                  lead.roomInventory.roomPrice != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(
                    children: [
                      const Icon(Icons.hotel, size: 18, color: AppColors.muted),
                      const SizedBox(width: 8),
                      Text(
                        '${lead.roomInventory.totalRooms ?? 0} Rooms'
                        '${lead.roomInventory.roomPrice != null ? ' • ₹${lead.roomInventory.roomPrice!.toStringAsFixed(0)} / night' : ''}',
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppColors.text,
                        ),
                      ),
                    ],
                  ),
                ),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    const Icon(
                      Icons.access_time,
                      size: 18,
                      color: AppColors.muted,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      'Captured: ${_formatDate(lead.capturedAt)}',
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
              if (lead.notes.isNotEmpty) ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Text(
                    lead.notes,
                    style: const TextStyle(
                      fontSize: 13,
                      color: AppColors.muted,
                    ),
                  ),
                ),
              ],
              // Recordings and transcripts kept on this phone for the lead.
              if (lead.id.isNotEmpty) ...[
                const SizedBox(height: 18),
                const Divider(height: 1),
                const SizedBox(height: 16),
                VoiceNotesSection(leadId: lead.id, leadName: lead.name),
              ],
              SizedBox(height: 16 + MediaQuery.of(ctx).padding.bottom),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filteredLeads;

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Customer Leads'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _fetchLeads,
            tooltip: 'Refresh Leads',
          ),
        ],
      ),
      body: Column(
        children: [
          // ── Search Bar ──────────────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: TextField(
              controller: _searchController,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: 'Search by property, owner, phone...',
                prefixIcon: const Icon(Icons.search, size: 20),
                suffixIcon: _searchController.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear, size: 18),
                        onPressed: () {
                          _searchController.clear();
                          setState(() {});
                        },
                      )
                    : null,
                contentPadding: const EdgeInsets.symmetric(
                  vertical: 10,
                  horizontal: 16,
                ),
              ),
            ),
          ),

          // ── Date Filters (Today, Yesterday, Tomorrow, Custom, All) ─────────
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Row(
              children: [
                _buildDateChip(
                  key: 'today',
                  label: 'Today',
                  count: _countForDate('today'),
                  icon: Icons.today,
                ),
                const SizedBox(width: 8),
                _buildDateChip(
                  key: 'yesterday',
                  label: 'Yesterday',
                  count: _countForDate('yesterday'),
                  icon: Icons.history,
                ),
                const SizedBox(width: 8),
                _buildDateChip(
                  key: 'tomorrow',
                  label: 'Tomorrow',
                  count: _countForDate('tomorrow'),
                  icon: Icons.event,
                ),
                const SizedBox(width: 8),
                _buildCustomDateChip(),
                const SizedBox(width: 8),
                _buildDateChip(
                  key: 'all',
                  label: 'All Time',
                  count: _countForDate('all'),
                  icon: Icons.calendar_view_day,
                ),
              ],
            ),
          ),

          // ── Status Filter Chips ─────────────────────────────────────────────
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            child: Row(
              children: _statusOptions.map((status) {
                final selected = _statusFilter == status;
                return Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: FilterChip(
                    label: Text(
                      status == 'all'
                          ? 'All Status'
                          : status[0].toUpperCase() + status.substring(1),
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: selected
                            ? FontWeight.w700
                            : FontWeight.w500,
                        color: selected ? Colors.white : AppColors.muted,
                      ),
                    ),
                    selected: selected,
                    showCheckmark: false,
                    selectedColor: AppColors.primary,
                    backgroundColor: Colors.white,
                    side: BorderSide(
                      color: selected ? AppColors.primary : AppColors.border,
                    ),
                    onSelected: (_) => setState(() => _statusFilter = status),
                  ),
                );
              }).toList(),
            ),
          ),

          // ── Leads Count Summary ─────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '${filtered.length} lead${filtered.length == 1 ? '' : 's'} found',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.muted,
                  ),
                ),
                if (_dateFilter == 'custom' && _customDate != null)
                  Text(
                    'Selected: ${DateFormat('dd MMM yyyy').format(_customDate!)}',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.primary,
                    ),
                  ),
              ],
            ),
          ),

          // ── Leads List ──────────────────────────────────────────────────────
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : filtered.isEmpty
                ? _buildEmptyState()
                : RefreshIndicator(
                    onRefresh: _fetchLeads,
                    child: ListView.separated(
                      padding: const EdgeInsets.fromLTRB(16, 6, 16, 80),
                      itemCount: filtered.length,
                      separatorBuilder: (context, index) =>
                          const SizedBox(height: 10),
                      itemBuilder: (context, index) {
                        final lead = filtered[index];
                        return _buildLeadCard(lead);
                      },
                    ),
                  ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'field_leads_tab_fab',
        onPressed: () async {
          await Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const FieldCreateLeadScreen()),
          );
          _fetchLeads();
        },
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add_location_alt),
        label: const Text('Capture Lead'),
      ),
    );
  }

  Widget _buildDateChip({
    required String key,
    required String label,
    required int count,
    required IconData icon,
  }) {
    final selected = _dateFilter == key;
    return ChoiceChip(
      avatar: Icon(
        icon,
        size: 15,
        color: selected ? Colors.white : AppColors.primary,
      ),
      label: Text('$label ($count)'),
      labelStyle: TextStyle(
        fontSize: 12,
        fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
        color: selected ? Colors.white : AppColors.text,
      ),
      selected: selected,
      selectedColor: AppColors.primary,
      backgroundColor: Colors.white,
      side: BorderSide(color: selected ? AppColors.primary : AppColors.border),
      onSelected: (val) {
        if (val) setState(() => _dateFilter = key);
      },
    );
  }

  Widget _buildCustomDateChip() {
    final selected = _dateFilter == 'custom';
    final dateText = _customDate != null
        ? DateFormat('dd MMM').format(_customDate!)
        : 'Custom Date';

    return ActionChip(
      avatar: Icon(
        Icons.calendar_month,
        size: 15,
        color: selected ? Colors.white : AppColors.primary,
      ),
      label: Text(
        selected ? 'Date: $dateText' : 'Custom...',
        style: TextStyle(
          fontSize: 12,
          fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
          color: selected ? Colors.white : AppColors.text,
        ),
      ),
      backgroundColor: selected ? AppColors.primary : Colors.white,
      side: BorderSide(color: selected ? AppColors.primary : AppColors.border),
      onPressed: _selectCustomDate,
    );
  }

  Widget _buildLeadCard(Lead lead) {
    return Card(
      elevation: 1,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _showLeadDetails(lead),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Title & Status
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      lead.name,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: AppColors.text,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: _statusBg(lead.status),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      lead.status.toUpperCase(),
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                        color: _statusColor(lead.status),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),

              // Owner & Call Action
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      const Icon(
                        Icons.person,
                        size: 15,
                        color: AppColors.muted,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        lead.contact.ownerName,
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                  if (lead.contact.phone.isNotEmpty)
                    InkWell(
                      onTap: () =>
                          launchUrl(Uri.parse('tel:${lead.contact.phone}')),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.successLight,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(
                              Icons.phone,
                              size: 13,
                              color: AppColors.success,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              lead.contact.phone,
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: AppColors.success,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),

              if (lead.location.formattedAddress.isNotEmpty) ...[
                const SizedBox(height: 6),
                Row(
                  children: [
                    const Icon(
                      Icons.location_on,
                      size: 14,
                      color: AppColors.primary,
                    ),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        lead.location.formattedAddress,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.muted,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ],

              const SizedBox(height: 8),
              const Divider(height: 1),
              const SizedBox(height: 8),

              // Bottom row: Rooms + Time
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    '${lead.roomInventory.totalRooms ?? 0} Rooms'
                    '${lead.roomInventory.roomPrice != null ? ' • ₹${lead.roomInventory.roomPrice!.toStringAsFixed(0)}' : ''}',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.text,
                    ),
                  ),
                  Text(
                    _formatDate(lead.capturedAt),
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.folder_open, size: 54, color: Colors.grey.shade400),
            const SizedBox(height: 16),
            Text(
              _dateFilter == 'today'
                  ? 'No leads captured today'
                  : _dateFilter == 'yesterday'
                  ? 'No leads captured yesterday'
                  : _dateFilter == 'tomorrow'
                  ? 'No leads scheduled for tomorrow'
                  : _dateFilter == 'custom'
                  ? 'No leads found for selected date'
                  : 'No leads found',
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: AppColors.text,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              'Tap "Capture Lead" below to add a new customer property from the field.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: AppColors.muted),
            ),
          ],
        ),
      ),
    );
  }
}
