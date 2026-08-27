using System.Collections;
using System.Collections.Generic;
using CampaignV2;
using TMPro;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.UI;

public class ShipSelectedPanel : MonoBehaviour
{
    public Slider healthSlider;
    public TextMeshProUGUI shipName;
    public TextMeshProUGUI shipClass;
    public TextMeshProUGUI crew;
    public TextMeshProUGUI marines;

    ShipSave shipSave;

    public List<SubsystemUnitManager> subsystemUnitManagers;
    public SubsystemUnitManager subsystemTemplate;
    public Transform subsystemDisplayGrid;

    public List<WeaponUnitManager> weaponUnitManagers;
    public WeaponUnitManager weaponTemplate;
    public Transform weaponsDisplayGrid;

    public Button repairHullButton;
    public TextMeshProUGUI repairButtonText;
    public TextMeshProUGUI shipHullText;

    public void HireCrewIncrement(int number)
    {

    }

    public void HireCrewAll(){

    }

    public void HireMarineIncrement(int number)
    {

    }

    public void HireMarineAll(){
        
    }
    
    public void RepairShip()
    {
        // todo: allow partial repair?
        var roundUpDamage = Mathf.CeilToInt(shipSave.shipHealthRemaining.ToDamage);
        var canRepair = CampaignMenu.Instance.UpdateMoney(roundUpDamage);
        //Debug.Log("check if we can repair");

        if (canRepair)
        {
            shipSave.shipHealthRemaining.value = shipSave.shipHealthRemaining.initial;
            repairHullButton.gameObject.SetActive(false);
            //Debug.Log("Ship repaired and saved.");
            shipHullText.text = $"{shipSave.shipHealthRemaining.value}/{shipSave.shipHealthRemaining.initial}";
            healthSlider.value = shipSave.shipHealthRemaining.ToPercent;
            CampaignMenu.Instance.fleetPanel.selectedShip.healthSlider.value = shipSave.shipHealthRemaining.ToPercent;
            CampaignMenu.Instance.SaveGame();
            CampaignMap.Instance.UpdateShip(shipSave);

        }
        else
        {
            // todo check if partial repair is possible? if then grey out repair button because all money gones
        }
    }

    public void SetShipSave(ShipSave ship, ShipManagerUnit shipManagerUnit) {

        if (ship == shipSave) return;

        subsystemDisplayGrid.gameObject.SetActive(true);
        
        shipSave = ship;

        healthSlider.value = ship.shipHealthRemaining.ToPercent;
        shipName.text = ship.customShipName;
        shipClass.text = ship.shipClass.ToString();
        crew.text = ship.remainingCrew.ToString();
        marines.text = ship.remainingMarines.ToString();
        shipHullText.text = $"{ship.shipHealthRemaining.value}/{ship.shipHealthRemaining.initial}";

        if(subsystemUnitManagers != null)
        {
            ClearSubsystems();
        }

        subsystemUnitManagers = new List<SubsystemUnitManager>();

        var mainThruster = Instantiate(subsystemTemplate, subsystemDisplayGrid);
        mainThruster.SetSubsystem(ship.mainThruster, ship, shipManagerUnit);
        subsystemUnitManagers.Add(mainThruster);

        foreach(var subs in ship.subsystemSaves)
        {
            var subUI = Instantiate(subsystemTemplate, subsystemDisplayGrid);
            subUI.SetSubsystem(subs, ship, shipManagerUnit);
            subsystemUnitManagers.Add(subUI);
        }

        if(weaponUnitManagers != null)
        {
            ClearWeapons();
        }
        
        foreach (var wep in ship.weaponControllerSaves)
        {
            var wepUI = Instantiate(weaponTemplate, weaponsDisplayGrid);
            wepUI.SetWeapon(wep, ship, shipManagerUnit);
            weaponUnitManagers.Add(wepUI);
        }

        // 1  hull = $1 ok? lol, round up geeze.
        if (ship.shipHealthRemaining.FullHealth)
        {
            repairHullButton.gameObject.SetActive(false);
        }
        else
        {
            var roundUpDamage = Mathf.CeilToInt(ship.shipHealthRemaining.ToDamage);
            repairButtonText.text = $"Repair (${roundUpDamage})";

            repairHullButton.gameObject.SetActive(true);
        }

        // todo need to setup weapons lol.

    }

    private void ClearSubsystems(){
        for(int i = subsystemUnitManagers.Count - 1; i >= 0; i--)
        {
            var sum = subsystemUnitManagers[i];
            Destroy(sum.gameObject);
            //Debug.Log($"remove subsystem {i}");
            subsystemUnitManagers.Remove(sum);
        }
    }


    private void ClearWeapons(){
        for(int i = weaponUnitManagers.Count - 1; i >= 0; i--)
        {
            var wep = weaponUnitManagers[i];

            Destroy(wep.gameObject);
            //Debug.Log($"remove weapon {i}");
            weaponUnitManagers.Remove(wep);
        }
    }


    // Start is called before the first frame update
    void Start()
    {
        if(CampaignMenu.Instance.fleetPanel.selectedShip == null)
        {
            subsystemDisplayGrid.gameObject.SetActive(false);
        }
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}

