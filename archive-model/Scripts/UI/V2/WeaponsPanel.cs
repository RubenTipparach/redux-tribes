using System.Collections;
using System.Collections.Generic;
using Unity.VisualScripting;
using UnityEngine;
using UnityEngine.UI;

public class WeaponsPanel : MonoBehaviour
{
    public Transform weaponContentPanel;

    public WeaponButtonTemplate weaponPrefab;

    private List<WeaponButtonTemplate> weaponButtons;

    public Button attackWithAllWeps;
    public Button disengageAllWeps;

    void Start(){
        attackWithAllWeps.onClick.AddListener(QueueAllWeapons);
        disengageAllWeps.onClick.AddListener(DisengageAllWeapons);
    }

    public void CheckControls()
    {
        if (Input.GetKeyDown(KeyCode.Z))
        {
            attackWithAllWeps.onClick.Invoke();
        }

        if (Input.GetKeyDown(KeyCode.X))
        {
            disengageAllWeps.onClick.Invoke();
        }
    }

    public void SetWeapons(ShipController ship)
    {
        if (weaponButtons == null)
        {
            weaponButtons = new List<WeaponButtonTemplate>();
        }

        if (ship.isPlayerShip)
        {

            for (int i = weaponButtons.Count - 1; i >= 0; i--)
            {
                Destroy(weaponButtons[i].gameObject);
            }

            weaponButtons.Clear();
            foreach (var weapon in ship.weapons)
            {
                var weaponUI = Instantiate(weaponPrefab, weaponContentPanel);
                var weaponIcon = GameManager.Instance.factionInfoLibrary.GetWeaponInfo(weapon.weaponIconType);
                weaponUI.Initialize(weaponIcon, weapon, ship);

                //Debug.Log($"ship weapons {weapon.gameObject.name}");
                weaponButtons.Add(weaponUI);
            }

            UpdateDisplayShipWeapons(ship);
            //Debug.LogError($"setting player weapon buttons");

        }
        else
        {
            ClearWeapons();
        }

        //UpdateAttackQueueUI(ship.attackOrders);
    }

    public void SetWeaponActive(int second)
    {

    }

    private void ClearWeapons()
    {
        var transformChildren = weaponButtons.Count;
        //Debug.LogError($"clearing {transformChildren} weapon buttons");
        for (int i = transformChildren - 1; i >= 0; i--)
        {
            Destroy(weaponButtons[i].gameObject);
        }
        weaponButtons.Clear();
        //UpdateDisplayShipWeapons(GameManager.Instance.shipSelected);

    }

    // not sure what this purpose was
    public void UpdateDisplayShipWeapons(ShipController ship)
    {
        if (weaponButtons == null)
        {
            return;
        }
        
        var transformChildren = weaponButtons.Count;

        if (ship.Targeting == null)
        {
            //noTargetSign.SetActive(true);
            for (int i = transformChildren - 1; i >= 0; i--)
            {
                weaponButtons[i].button.interactable = false;
            }
        }
        else
        {
            //noTargetSign.SetActive(false);

            for (int i = transformChildren - 1; i >= 0; i--)
            {
                weaponButtons[i].button.interactable = true;
            }
        }
        var second = Mathf.RoundToInt(GameManager.Instance.selectedTime);

        UpdateWeaponSelection(ship, second);

    }

    // TODO: move queue and disengage button into generalized procedures so AI can use them too!
    public void QueueAllWeapons(){
        var shipSelected = GameManager.Instance.shipSelected;
        var simulationController = GameManager.Instance.simulationController;
        var second = Mathf.RoundToInt(GameManager.Instance.selectedTime);

        if(shipSelected!= null && shipSelected.isPlayerShip && simulationController.SimulationState != SimulationState.Simulating) 
        {
            //shipSelected.ClearTargets();
            //uiController.UpdateAttackQueueUI(shipSelected.attackOrders); // todo display weapons on ship based on weapons currently active.
            foreach(var wep in weaponButtons)
            {
                wep.AttackWithWeapon();// oh it automatically selects current second.
            }
            //UpdateDisplayShipWeapons(GameManager.Instance.shipSelected);
            UpdateWeaponSelection(GameManager.Instance.shipSelected, second);
        }
    }

    public void DisengageAllWeapons(){
        var shipSelected = GameManager.Instance.shipSelected;
        var simulationController = GameManager.Instance.simulationController;
        var second = Mathf.RoundToInt(GameManager.Instance.selectedTime);

        if (shipSelected != null && shipSelected.isPlayerShip && simulationController.SimulationState != SimulationState.Simulating)
        {
            GameManager.Instance.DisengageFromTarget(true);

            UpdateAttackQueueUI(GameManager.Instance.shipSelected.attackOrders);
            UpdateWeaponSelection(GameManager.Instance.shipSelected, second);
        }
    }

    public void UpdateAttackQueueUI(
        Dictionary<int, List<AttackInformation>> attackQueue
        )
    {
        //TODO: replace with my own queue UI
        var queueUI = GameManager.Instance.uiManagerV2.timeSliderController.queueUI;
        for (int i = 0; i < 11; i++)
        {
            queueUI[i].ClearUI();
            if (attackQueue.ContainsKey(i) && attackQueue[i].Count > 0)
            {
                queueUI[i].ActivateUI(attackQueue[i]);
            }

        }
        

        //LogWaponQueue(attackQueue);
    }

    
    public void UpdateWeaponSelection(ShipController ship, int queueSecond)
    {
        //var weaponQueue = ship.QueueWeaponAttack
        Debug.Log("updating weapon buttons lol");
        for (int i = 0; i < weaponButtons.Count; i++)
        {

            var attackOrder =
                weaponButtons[i].weaponController.attackInfoOrder;
            if (attackOrder != null && attackOrder.secondSlot == queueSecond && attackOrder.IsSet)
            {
                weaponButtons[i].SetButtonSelected(true);
                //Debug.Log("weapon active");
            }
            else
            {
                weaponButtons[i].SetButtonSelected(false);
                //Debug.Log("weapon unactive");
            }
        }
    }
}
