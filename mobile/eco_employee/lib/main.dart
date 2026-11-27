import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'router.dart';

/// Staff roles that use this app. Admins use the web dashboard; distributors the portal; customers their own app.
const employeeRoles = {'field_sales', 'tele_sales', 'sales_manager', 'field_support', 'support_manager', 'hr'};

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('en_IN');
  // Push works only once the Firebase files are added (see mobile/README.md).
  await PushSetup.init();
  runApp(ProviderScope(
    overrides: [
      authConfigProvider.overrideWithValue(const AuthConfig(
        allowedRoles: employeeRoles,
        wrongAppMessage: 'This app is for Eco Sor staff. Distributors use the web portal; customers use the Eco Sor customer app.',
        tokenKey: 'eco_employee_token',
      )),
    ],
    child: const EcoEmployeeApp(),
  ));
}

class EcoEmployeeApp extends ConsumerWidget {
  const EcoEmployeeApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'Eco Sor',
      debugShowCheckedModeBanner: false,
      theme: ecoTheme(),
      routerConfig: ref.watch(routerProvider),
    );
  }
}
