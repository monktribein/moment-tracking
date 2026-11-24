import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import 'field_shift_screen.dart';
import 'field_leads_screen.dart';
import 'field_profile_screen.dart';

class FieldShell extends StatefulWidget {
  const FieldShell({super.key});

  @override
  State<FieldShell> createState() => _FieldShellState();
}

class _FieldShellState extends State<FieldShell> {
  int _currentIndex = 0;

  /// Bumped to rebuild a tab with fresh data (tabs stay alive in the stack).
  int _leadsVersion = 0;
  int _profileVersion = 0;

  void _goToTab(int index) {
    setState(() {
      // Profile shows today's check-in/out: fetch it again each time it opens.
      if (index == 2 && _currentIndex != 2) _profileVersion++;
      _currentIndex = index;
    });
  }

  @override
  Widget build(BuildContext context) {
    final screens = [
      FieldShiftScreen(
        onNavigateToLeads: () => _goToTab(1),
        onNavigateToProfile: () => _goToTab(2),
        // A lead captured from the Shift tab must show up in My Leads.
        onLeadCaptured: () => setState(() => _leadsVersion++),
      ),
      FieldLeadsScreen(key: ValueKey('leads-$_leadsVersion')),
      FieldProfileScreen(key: ValueKey('profile-$_profileVersion')),
    ];

    return Scaffold(
      body: IndexedStack(index: _currentIndex, children: screens),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: _goToTab,
        backgroundColor: Colors.white,
        elevation: 4,
        indicatorColor: AppColors.primaryLight,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.speed_outlined),
            selectedIcon: Icon(Icons.speed, color: AppColors.primary),
            label: 'Shift',
          ),
          NavigationDestination(
            icon: Icon(Icons.assignment_outlined),
            selectedIcon: Icon(Icons.assignment, color: AppColors.primary),
            label: 'My Leads',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person, color: AppColors.primary),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}
